// backend/index.js — full drop-in (with robust CORS + uploads CORP)
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const Stripe = require("stripe");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const nodemailer = require("nodemailer");

// Optional Resend (HTTPS email API)
let Resend = null;
try { Resend = require("resend").Resend; } catch { /* not installed; fine */ }

// Shared in-memory DB
const { users, ensureFriendState } = require("./db");

// Routes
const accountRoutes = require("./accountRoutes");
const friendsRoutes = require("./friendsRoutes");
const chatRoutes = require("./chatRoutes");
const chatGlobal = require("./chatGlobal");
const galleryRoutes = require("./galleryRoutes"); // ⬅️ gallery API
const notifications = require("./notifications");


const app = express();



// very small request logger
app.use((req, _res, next) => { console.log(`[req] ${req.method} ${req.url}`); next(); });

// --- config/env ---
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const PORT = Number(process.env.PORT || 5050);
const STRIPE_SECRET = process.env.STRIPE_SECRET || "";
const stripe = new Stripe(STRIPE_SECRET || "sk_test_dummy", { apiVersion: "2024-06-20" });

const SERVER_PUBLIC_URL = process.env.SERVER_PUBLIC_URL || `http://localhost:${PORT}`;
const CONTEST_INBOX = process.env.CONTEST_INBOX || "";

/* ---------------------- ROBUST CORS ---------------------- */
// Always advertise base allowances (helps caches/proxies)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Stripe-Signature, x-user-id, x-user-name, x-dev-key"
  );
  res.setHeader("Vary", "Origin");
  next();
});

// Reflect the request Origin so ACAO is always present.
// If you want to pin to a list, replace `true` with a function check.
app.use(
  cors({
    origin: true, // reflect Origin
    credentials: true, // ✅ allow cookies/session/fetch include
    maxAge: 86400,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Stripe-Signature",
      "x-user-id",
      "x-user-name",
        "x-dev-key"

    ],
  })
);

// Answer ALL preflights immediately (avoid path-to-regexp "*" crash)
app.use((req, res, next) => {
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.set("trust proxy", 1);
/* ------------------- END ROBUST CORS --------------------- */

// --- uploads dir and static serving (avatars + contest PDFs + gallery) ---
const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Serve /uploads with headers that are safe for cross-origin <img> on Vercel
const ALLOWED_UPLOAD_ORIGINS = new Set([
  "https://meadhall-site.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

app.use(
  "/uploads",
  (req, res, next) => {
    const origin = req.headers.origin || "";
    if (ALLOWED_UPLOAD_ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    } else {
      // default to your Vercel site so hotlinks still work in prod
      res.setHeader("Access-Control-Allow-Origin", "https://meadhall-site.vercel.app");
    }
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");

    // ✅ Key for cross-origin images (prevents CORB/CORP issues)
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

    // Nice-to-have safety
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  },
  express.static(uploadsDir, {
    setHeaders(res, filePath) {
      if (/\.(png|jpe?g|webp|gif|avif)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("Accept-Ranges", "bytes");
      } else if (/\.pdf$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=86400");
      }
    },
  })
);

// expose uploadsDir so galleryRoutes uses the same folder
app.locals.uploadsDir = uploadsDir;

// --- simple JSON "DB" for purchases ---
const DATA_DIR = path.join(__dirname, "data");
const PURCHASES_FILE = path.join(DATA_DIR, "purchases.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(PURCHASES_FILE)) fs.writeFileSync(PURCHASES_FILE, "[]");
function appendRecord(rec) {
  try {
    const arr = JSON.parse(fs.readFileSync(PURCHASES_FILE, "utf8"));
    arr.push(rec);
    fs.writeFileSync(PURCHASES_FILE, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error("Failed to write purchases.json:", e.message);
  }
}


/* ==============================
   simple JSON "DB" for users
   ============================== */
const USERS_FILE = path.join(DATA_DIR, "users.json");
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");

function loadUsersFromDisk() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveUsersToDisk(arr) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(arr, null, 2));
  } catch (e) {
    console.error("Failed to save users.json:", e.message);
  }
}

// --- Email setup: Resend (preferred) + SMTP fallback ---
const FROM_EMAIL =
  process.env.FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;

// Allow Resend only if a key exists AND the sender is NOT the onboarding address
const HAVE_RESEND =
  !!(process.env.RESEND_API_KEY && Resend && FROM_EMAIL && !/onboarding@resend\.dev/i.test(FROM_EMAIL));

const resendClient = HAVE_RESEND ? new Resend(process.env.RESEND_API_KEY) : null;


let smtpTransport = null;
if (process.env.SMTP_HOST) {
  // Force IPv4 + pooling profile
  const baseSMTP = {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: (process.env.SMTP_USER && process.env.SMTP_PASS)
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    pool: true, maxConnections: 3, maxMessages: 50, keepAlive: true,
    family: 4, socketTimeout: 30000,
    tls: { servername: process.env.SMTP_HOST, rejectUnauthorized: false, minVersion: "TLSv1.2" },
  };

  smtpTransport = nodemailer.createTransport(baseSMTP);

  (async function verifyOrFallback() {
    try {
      await smtpTransport.verify();
      console.log(
        "📨 SMTP ready:",
        `${smtpTransport.options.host}:${smtpTransport.options.port}`,
        smtpTransport.options.secure ? "(SMTPS 465)" : "(STARTTLS 587)"
      );
    } catch (err) {
      console.error("❌ SMTP verify failed:", err.message);
      const on587 = Number(process.env.SMTP_PORT || 587) === 587 && String(process.env.SMTP_SECURE || "false") !== "true";
      if (on587) {
        console.warn("↪️ Retrying via 465/SMTPS with IPv4 + pool…");
        smtpTransport = nodemailer.createTransport({
          ...baseSMTP,
          port: 465,
          secure: true,
        });
        await smtpTransport.verify();
        console.log("✅ SMTP fallback ready:", `${smtpTransport.options.host}:465 (SMTPS)`);
      }
    }
  })().catch(e => console.error("SMTP setup error:", e.message));
}

// unified email helper
async function sendEmail({ to, subject, text, html, attachments }) {
  const recipients = Array.isArray(to) ? to : [to];
  let lastErr = null;

  // Try Resend first ONLY if allowed (note: no path-based attachments here)
  if (resendClient) {
    try {
      const payload = { from: FROM_EMAIL, to: recipients, subject, text, html };
      const r = await resendClient.emails.send(payload);
      console.log("📧 sendEmail ->", { to: recipients, subject, using: "resend", from: FROM_EMAIL, id: r?.id || null });
      return { ok: true, provider: "resend", id: r?.id || null };
    } catch (e) {
      lastErr = e;
      console.warn("sendEmail via Resend failed:", e?.response?.data || e?.message || e);
      // fall through to SMTP
    }
  }

  // Fallback / primary: SMTP (supports { path } attachments)
  if (smtpTransport) {
    try {
      const info = await smtpTransport.sendMail({
        from: FROM_EMAIL,
        to: recipients,
        subject,
        text,
        html,
        attachments,
      });
      console.log("📧 sendEmail ->", { to: recipients, subject, using: "smtp", from: FROM_EMAIL, id: info?.messageId || null });
      return { ok: true, provider: "smtp", id: info?.messageId || null };
    } catch (e) {
      lastErr = e;
      console.error("sendEmail via SMTP failed:", e?.message || e);
    }
  }

  throw new Error("No email provider configured or both failed" + (lastErr ? `: ${lastErr.message || lastErr}` : ""));
}


// --- Stripe webhook BEFORE json middleware ---
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy";
    const event = stripe.webhooks.constructEvent(req.body, sig, secret);

    if (event.type === "checkout.session.completed") {
      const s = event.data.object;

      let priceId = null;
      try {
        const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 10 });
        priceId = items?.data?.[0]?.price?.id || null;
      } catch (e) {
        console.warn("Could not list line items:", e.message);
      }

      appendRecord({
        ts: Date.now(),
        event: "checkout.session.completed",
        mode: s.mode,
        sessionId: s.id,
        customerId: s.customer || null,
        customerEmail: s.customer_details?.email || s.customer_email || null,
        subscriptionId: s.subscription || null,
        userId: s.metadata?.userId || null,
        priceId,
        entryId: s.metadata?.entryId || null,
      });

      // --- One-time Brísingr fulfillment ---
if (s.mode === "payment" && s.metadata?.source === "brisingr") {
  const userId = s.metadata.userId || null;
  const tier   = s.metadata.tier  || "";
  const amount = brisingrForTier(tier);

  if (userId && typeof app.locals.brisingrCredit === "function") {
    try {
      await app.locals.brisingrCredit(userId, amount);
    } catch (e) {
      console.error("brisingrCredit failed:", e.message);
    }
  }

  appendRecord({
    ts: Date.now(),
    event: "brisingr.credited",
    sessionId: s.id,
    userId,
    tier,
    credited: amount,
    priceId,
  });

  console.log(`💎 Credited ${amount} Brísingr to ${userId} (tier ${tier})`);
}


      // ✅ Stamp membership (this unlocks frames the same way Mead Hall is unlocked)
      const plan = planFromPrice(priceId);
      if (plan) {
        setMembership({
          userId: s.metadata?.userId || null,
          email:  s.customer_details?.email || s.customer_email || null,
          membership: plan, // 'premium' (monthly), 'annual', or 'reader'
        });
      }

      // Contest email on success
      if (s.mode === "payment" && s.metadata?.entryId) {
        let entry = findContestEntry(s.metadata.entryId);

        if (!entry && s.metadata?.fileBasename) {
          const fn = s.metadata.fileBasename;
          const fp = path.join(uploadsDir, fn);
          entry = {
            id: s.metadata.entryId,
            name: s.metadata.entryName || "Skald Entry",
            userId: s.metadata.userId || null,
            filePath: fp,
            fileUrl: `/uploads/${fn}`,
            originalName: fn,
            uploadedAt: Date.now(),
            emailed: false,
          };
        }

        if (entry && CONTEST_INBOX) {
          try {
            await sendContestEmail(entry, s.customer_details?.email || s.customer_email || null);
            console.log("📧 Contest entry emailed:", entry.id);
          } catch (e) {
            console.error("Email send error:", e.message);
          }
        } else {
          if (!entry) console.error("⚠️ Contest entry not found for entryId:", s.metadata.entryId);
          if (!CONTEST_INBOX) console.error("⚠️ CONTEST_INBOX not set; cannot send email.");
        }
      }
    }

    if (event.type === "invoice.payment_succeeded") {
      const inv = event.data.object;
      appendRecord({
        ts: Date.now(),
        event: "invoice.payment_succeeded",
        customerId: inv.customer || null,
        customerEmail: inv.customer_email || null,
        subscriptionId: inv.subscription || null,
        amount_paid: inv.amount_paid,
        currency: inv.currency,
        invoiceId: inv.id,
      });
      console.log("💸 invoice.payment_succeeded", { invoiceId: inv.id, amount: inv.amount_paid });
    }

    // Optional: clear membership when the subscription is canceled
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      setMembership({
        userId: sub.metadata?.userId || null,
        membership: "none",
      });
    }

    res.json({ received: true });
  } catch (e) {
    console.error("Webhook error:", e.message);
    res.status(400).send(`Webhook Error: ${e.message}`);
  }
});

// JSON routes AFTER webhook
app.use(bodyParser.json());

// SMTP verify endpoint
app.get("/api/smtp/verify", async (_req, res) => {
  try {
    if (!smtpTransport) return res.status(400).json({ ok: false, error: "SMTP not configured" });
    await smtpTransport.verify();
    res.json({
      ok: true,
      using: `${smtpTransport.options.host}:${smtpTransport.options.port}`,
      mode: smtpTransport.options.secure ? "SMTPS (465)" : "STARTTLS (587)",
      ipv: smtpTransport.options.family === 4 ? "IPv4" : "default",
      pooled: !!smtpTransport.options.pool,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

// --- In-memory Users ---
let uid = 1;

/* hydrate users from disk and bump uid high-water mark */
(function bootstrapUsers() {
  const arr = loadUsersFromDisk();
  users.clear();
  let maxNum = 0;
  for (const u of arr) {
    users.set(u.id, u);
    const m = /^u_(\d+)$/.exec(String(u.id));
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
  }
  uid = Math.max(uid, maxNum + 1);
})();

// Create free account
app.post("/api/users", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).send("Missing fields");

  const exists = [...users.values()].some(
    (u) => (u.email || "").toLowerCase() === String(email).toLowerCase()
  );
  if (exists) return res.status(409).send("Email already registered");

  const user = {
    id: `u_${uid++}`,
    name,
    email,
    password,
    avatarUrl: "",
    bio: "",
    interests: "",
    createdAt: Date.now(),
    membership: "none"
  };
  users.set(user.id, user);

  // persist to disk
  const disk = loadUsersFromDisk();
  disk.push(user);
  saveUsersToDisk(disk);

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    interests: user.interests,
    membership: user.membership || "none",
  });
});

// Basic login
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).send("Missing credentials");

  const match = [...users.values()].find(
    (u) => (u.email || "").toLowerCase() === String(email).toLowerCase() && u.password === password
  );
  if (!match) return res.status(401).send("Invalid credentials");

  res.json({
    id: match.id,
    name: match.name,
    email: match.email,
    avatarUrl: match.avatarUrl,
    bio: match.bio,
    interests: match.interests,
    membership: match.membership || "none",
  });
});

// 🔎 Search users
app.get("/api/users/search", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (!q) return res.json([]);

  const results = [...users.values()]
    .filter((u) =>
      String(u.id).toLowerCase() === q ||
      String(u.name || "").toLowerCase().includes(q) ||
      String(u.email || "").toLowerCase().includes(q)
    )
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      avatarUrl: u.avatarUrl || "",
      bio: u.bio || "",
      interests: u.interests || "",
      membership: u.membership || "none",
    }));

  res.json(results);
});

// READ ONE USER
app.get("/api/users/:id", (req, res) => {
  const u = users.get(req.params.id);
  if (!u) return res.status(404).json({ error: "User not found" });
  res.json({
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl || "",
    bio: u.bio || "",
    interests: u.interests || "",
    membership: u.membership || ""
  });
});

// Lookup purchases by email
app.get("/api/subscription/by-email", (req, res) => {
  const email = (req.query.email || "").toString().toLowerCase();
  if (!email) return res.status(400).send("email is required");
  try {
    const arr = JSON.parse(fs.readFileSync(PURCHASES_FILE, "utf8"));
    const matches = arr.filter((r) => (r.customerEmail || "").toLowerCase() === email);
    res.json({ matches });
  } catch {
    res.status(500).send("Failed to read records");
  }
});

// --- Stripe price IDs ---
const PRICE = {
  reader: process.env.STRIPE_PRICE_READER,
  premium: process.env.STRIPE_PRICE_PREMIUM,
  annual: process.env.STRIPE_PRICE_ANNUAL,
};

// --- membership helpers ---
function planFromPrice(priceId) {
  if (!priceId) return null;

  // Match the right Stripe price IDs to plan names
  if (priceId === PRICE.premium) return "premium";
  if (priceId === PRICE.annual)  return "annual";
  if (priceId === PRICE.reader)  return "reader";

  // If no match, return null (avoid undefined)
  return null;
}

// --- One-time Brísingr recharge tiers ---
const BRISINGR_PRICE = {
  "100":   process.env.STRIPE_PRICE_BRISINGR_100,
  "500":   process.env.STRIPE_PRICE_BRISINGR_500,
  "1000":  process.env.STRIPE_PRICE_BRISINGR_1000,
  "2000":  process.env.STRIPE_PRICE_BRISINGR_2000,
  "5000":  process.env.STRIPE_PRICE_BRISINGR_5000,
  "10000": process.env.STRIPE_PRICE_BRISINGR_10000,
};

// Base + bonus table for each tier
function brisingrForTier(tier) {
  const table = {
    "100":   200,   // 100 + 100 bonus
    "500":   800,   // 500 + 300 bonus
    "1000":  1800,  // 1000 + 800 bonus
    "2000":  6000,  // 2000 + 4000 bonus
    "5000":  11000, // 5000 + 6000 bonus
    "10000": 25000, // 10000 + 15000 bonus
  };
  return table[String(tier)] || 0;
}





function saveUsersMapToDisk() {
  const arr = [...users.values()];
  saveUsersToDisk(arr);
}

// set membership by userId (preferred) or by email (fallback)
function setMembership({ userId, email, membership }) {
  if (!membership) return;
  if (userId && users.has(userId)) {
    const u = users.get(userId);
    u.membership = membership;
    users.set(u.id, u);
    saveUsersMapToDisk();
    return;
  }
  if (email) {
    const u = [...users.values()].find(
      x => (x.email || "").toLowerCase() === String(email).toLowerCase()
    );
    if (u) {
      u.membership = membership;
      users.set(u.id, u);
      saveUsersMapToDisk();
    }
  }
}

// Subscription checkout
app.post("/api/stripe/checkout", async (req, res) => {
  try {
    const plan = req.body.plan || "reader";
    const userId = req.body.userId || null;
    const price = PRICE[plan];
    if (!price) return res.status(400).send("Missing or unknown plan");

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      success_url: `${CLIENT_URL}/#success`,
      cancel_url: `${CLIENT_URL}/#canceled`,
      allow_promotion_codes: true,
      metadata: { userId: userId || "" },
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).send("Checkout failed");
  }
});
// --- Brísingr one-time checkout route ---
app.post("/api/game/checkout/brisingr/:tier", async (req, res) => {
  try {
    const userId = String(req.body.userId || "");
    const tier   = String(req.params.tier || "");
    const price  = BRISINGR_PRICE[tier];

    if (!userId) return res.status(400).send("userId required");
    if (!price)  return res.status(400).send("Unknown tier");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price, quantity: 1 }],
      success_url: `${CLIENT_URL}/game.html?success=true`,
      cancel_url:  `${CLIENT_URL}/game.html?canceled=true`,
      metadata: { userId, source: "brisingr", tier },
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error("brisingr checkout failed:", e);
    res.status(500).send("Checkout failed");
  }
});



// --- Avatar upload ---
const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || "avatar.png").replace(/\s+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});
app.post("/api/account/avatar", uploadAvatar.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  return res.json({ url: `/uploads/${req.file.filename}` });
});

/* ========= Email-code signup (in-memory) ========= */
const VERIFY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const verifyCodes = new Map(); // email(lowercase) -> { code, exp }
const makeCode = (len = 6) => Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join("");
const now = () => Date.now();

// Request a verification code
app.post("/api/auth/request-code", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "email required" });

    const code = makeCode(6);
    verifyCodes.set(email, { code, exp: now() + VERIFY_TTL_MS });

    try {
      await sendEmail({
        to: email,
        subject: "Your Mead Hall verification code",
        text: `Your code is: ${code}\nIt expires in 10 minutes.`,
      });
    } catch (e) {
      console.warn("verify mail send failed:", e.message);
    }

    const dev = String(process.env.NODE_ENV || "").toLowerCase() !== "production" || String(process.env.VERIFY_DEBUG || "").toLowerCase() === "true";
    return res.json({ ok: true, ...(dev ? { code } : {}) });
  } catch (e) {
    console.error("request-code error:", e.message);
    return res.status(500).json({ error: "failed to send code" });
  }
});

// Confirm a code
app.post("/api/auth/confirm", (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code  = String(req.body?.code || "").trim();
    if (!email || !code) return res.status(400).json({ error: "email and code required" });

    const rec = verifyCodes.get(email);
    if (!rec) return res.status(400).json({ error: "no code requested" });
    if (now() > rec.exp) { verifyCodes.delete(email); return res.status(400).json({ error: "code expired" }); }
    if (rec.code !== code) return res.status(400).json({ error: "invalid code" });

    verifyCodes.delete(email);
    return res.json({ ok: true });
  } catch (e) {
    console.error("confirm error:", e.message);
    return res.status(500).json({ error: "confirm failed" });
  }
});

// periodic cleanup of expired codes
setInterval(() => {
  const t = now();
  for (const [k, v] of verifyCodes.entries()) if (t > v.exp) verifyCodes.delete(k);
}, 60 * 1000);

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------------- Profile Frame Helper (server-side injection only) ----------------
function applyFrameClass(u) {
  if (!u || typeof u !== "object") return u;
  const m = (u.membership || "").toLowerCase();
  let frameClass = "pfp--reader";
  if (m === "premium") frameClass = "pfp--premium";
  else if (m === "annual") frameClass = "pfp--annual";
  return { ...u, frameClass };
}
function addFrameToResponse(data) {
  if (Array.isArray(data)) return data.map(applyFrameClass);
  return applyFrameClass(data);
}

// ✅ Wrap res.json so any /api/users* response includes frameClass
app.use((req, res, next) => {
  const oldJson = res.json.bind(res);
  res.json = (data) => {
    try {
      if (req.path.startsWith("/api/users")) {
        data = addFrameToResponse(data);
      }
    } catch (e) {
      console.error("❌ Frame inject error:", e);
    }
    return oldJson(data);
  };
  next();
});

// NOTE: Any DOM-related frame code (wrapping <img class="avatar">, localStorage, etc.)
// MUST live on the frontend (e.g., profile.js). Do not use document/localStorage in Node.

// Mount routes (your originals)
accountRoutes.install(app);
friendsRoutes.install(app);
chatRoutes.install(app);
chatGlobal.install(app);
notifications.install(app);
app.locals.notify = notifications.createNotification; // ✅ expose notifier
// 👇 Add this right here
galleryRoutes.install(app);
 /* ==============================
   Mug Reactions (in-memory)
   ============================== */
// shape: votes[target][userId] = "up" | "down"
const mugVotes = Object.create(null);

function mugCounts(target) {
  const t = mugVotes[target] || {};
  let up = 0, down = 0;
  for (const v of Object.values(t)) {
    if (v === "up") up++;
    else if (v === "down") down++;
  }
  return { up, down };
}

// GET /api/reactions/mug?target=homepage
app.get("/api/reactions/mug", (req, res) => {
  const target = String(req.query.target || "homepage");
  return res.json(mugCounts(target));
});

// POST /api/reactions/mug  { target, action: "up"|"down"|"clear" }
app.post("/api/reactions/mug", (req, res) => {
  const target = String(req.body?.target || "homepage");
  const action = String(req.body?.action || "").toLowerCase(); // up | down | clear
  const userId = String(req.headers["x-user-id"] || "").trim();

  if (!userId) return res.status(401).json({ error: "userId header required" });

  mugVotes[target] ||= Object.create(null);

  if (action === "clear") {
    delete mugVotes[target][userId];
  } else if (action === "up" || action === "down") {
    mugVotes[target][userId] = action;
  } else {
    return res.status(400).json({ error: "action must be up|down|clear" });
  }

  const { up, down } = mugCounts(target);
  return res.json({ target, action, up, down });
});


// ⬇⬇⬇ ADD: Minimal “mark read” endpoints so the frontend stops 404'ing.
// If notifications router already provides them, these act as safe fallbacks.
app.post("/api/notifications/read", (req, res) => {
  // Accept { userId, ids:[] } but do not persist (in-memory can be added later)
  const { userId, ids } = req.body || {};
  if (!userId) return res.status(400).json({ ok:false, error:"userId required" });
  console.log("🔔 /api/notifications/read", { userId, count: Array.isArray(ids) ? ids.length : 0 });
  return res.json({ ok: true, updated: Array.isArray(ids) ? ids.length : 0 });
});

// Alias some frontends use
app.post("/api/notifications/mark-read", (req, res) => {
  const { userId, ids } = req.body || {};
  if (!userId) return res.status(400).json({ ok:false, error:"userId required" });
  console.log("🔔 /api/notifications/mark-read", { userId, count: Array.isArray(ids) ? ids.length : 0 });
  return res.json({ ok: true, updated: Array.isArray(ids) ? ids.length : 0 });
});



/* ======== Friends-of-User (public read-only) — used by friendprofile.html ======== */
function safeUser(u) {
  if (!u) return null;
  const { id, name, email, avatarUrl, bio, interests, membership } = u; // ⬅️ include membership
  return { id, name, email, avatarUrl, bio, interests, membership: membership || "" };
}

function listFriendsOf(userId) {
  const rec = ensureFriendState(userId);
  return [...rec.friends].map(fid => safeUser(users.get(fid))).filter(Boolean);
}

// GET /api/users/:id/friends
app.get("/api/users/:id/friends", (req, res) => {
  const id = String(req.params.id || "");
  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!users.has(id)) return res.status(404).json({ error: "User not found" });
  return res.json(listFriendsOf(id));
});

// GET /api/users/:id/companions (alias for friends)
app.get("/api/users/:id/companions", (req, res) => {
  const id = String(req.params.id || "");
  if (!id) return res.status(400).json({ error: "Missing id" });
  if (!users.has(id)) return res.status(404).json({ error: "User not found" });
  return res.json(listFriendsOf(id));
});

// Global error handler — makes 500s readable
app.use((err, req, res, _next) => {
  console.error("[error]", err && (err.stack || err.message || err));
  res.status(500).json({ ok: false, error: String(err && (err.message || err)) });
});

// Debug: list all mounted routes (one endpoint)
app.get("/api/_routes", (_req, res) => {
  const routes = [];
  app._router.stack.forEach((m) => {
    if (m.route && m.route.path) {
      routes.push({ method: Object.keys(m.route.methods)[0]?.toUpperCase(), path: m.route.path });
    } else if (m.name === "router" && m.handle?.stack) {
      m.handle.stack.forEach((h) => {
        const r = h.route;
        if (r) routes.push({ method: Object.keys(r.methods)[0]?.toUpperCase(), path: r.path });
      });
    }
  });
  res.json(routes);
});

// Backend root should NOT be the website
app.get("/", (_req, res) => {
  res.status(200).send("Mead Hall API is running. Visit the frontend on Vercel.");
});

// Prevent backend from serving frontend HTML by accident
app.get(["/meadhall.html", "/index.html"], (_req, res) => {
  res.status(404).send("Not found. Use the frontend site.");
});


app.listen(PORT, () => console.log(`🛡️ Backend listening on ${PORT}`));

/* ==============================
   helper used by webhook (contest email)
   ============================== */
async function sendContestEmail(entry, buyerEmail) {
  if (!CONTEST_INBOX) throw new Error("CONTEST_INBOX not set");

  const fileUrl = `${SERVER_PUBLIC_URL}${entry.fileUrl}`;
  const text =
    `Skald contest submission\n\n` +
    `Title: ${entry.name}\n` +
    `User ID: ${entry.userId || "(anonymous)"}\n` +
    `Buyer Email: ${buyerEmail || "(unknown)"}\n` +
    `Uploaded: ${new Date(entry.uploadedAt).toISOString()}\n` +
    `File URL: ${fileUrl}\n`;

  await sendEmail({
    to: CONTEST_INBOX,
    subject: `[Skald Contest] ${entry.name} (${entry.id})`,
    text,
    attachments: entry.filePath ? [{
      filename: entry.originalName || "story.pdf",
      path: entry.filePath,
      contentType: "application/pdf",
    }] : undefined,
  });
}






















































