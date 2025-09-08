// backend/index.js â€” full drop-in server
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const Stripe = require("stripe");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const nodemailer = require("nodemailer");

const { users } = require("./db");

// Routes
const accountRoutes = require("./accountRoutes");
const friendsRoutes = require("./friendsRoutes");
const chatRoutes = require("./chatRoutes");
const chatGlobal = require("./chatGlobal");

const app = express();

// --- config/env ---
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const PORT = Number(process.env.PORT || 5050);
const STRIPE_SECRET = process.env.STRIPE_SECRET || "";
const stripe = new Stripe(STRIPE_SECRET || "sk_test_dummy", { apiVersion: "2024-06-20" });

const SERVER_PUBLIC_URL = process.env.SERVER_PUBLIC_URL || `http://localhost:${PORT}`;
const CONTEST_INBOX = process.env.CONTEST_INBOX || ""; // where contest emails go

// --- CORS (allow your dev origins + custom headers) ---
const allowedOrigins = new Set([
  CLIENT_URL,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://meadhall-site.vercel.app",
]);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allow = new Set([
        CLIENT_URL,
        "https://meadhall-site.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ]);
      cb(null, allow.has(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: (req, cb) =>
      cb(null, req.header("Access-Control-Request-Headers") || "Content-Type, Authorization, x-user-id"),
    maxAge: 86400,
  })
);
app.options("*", cors());},
    credentials: true,
    methods: ["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-user-id", // custom auth header if needed
    ],
    maxAge: 86400,
  })
);

// Some proxies need this for keep-alive connections (SSE etc.)
app.set("trust proxy", 1);

// --- uploads dir and static serving (avatars + contest PDFs) ---
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

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

// --- simple JSON "DB" for contest entries ---
const CONTEST_FILE = path.join(DATA_DIR, "contest_entries.json");
if (!fs.existsSync(CONTEST_FILE)) fs.writeFileSync(CONTEST_FILE, "[]");

function readContestEntries() {
  try { return JSON.parse(fs.readFileSync(CONTEST_FILE, "utf8")); }
  catch { return []; }
}
function writeContestEntries(arr) {
  fs.writeFileSync(CONTEST_FILE, JSON.stringify(arr, null, 2));
}
function saveContestEntry(entry) {
  const arr = readContestEntries();
  arr.push(entry);
  writeContestEntries(arr);
}
function findContestEntry(id) {
  const arr = readContestEntries();
  return arr.find(e => String(e.id) === String(id)) || null;
}

// --- Nodemailer setup (optional but recommended) ---
let mailer = null;
if (process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // verify SMTP on boot
  mailer.verify()
    .then(() => console.log("ðŸ“¨ SMTP ready:", process.env.SMTP_HOST))
    .catch(err => console.error("âŒ SMTP verify failed:", err.message));
}

// --- Multer for contest PDF upload (safe names) ---
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || "entry.pdf").replace(/\s+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});
const uploadPDF = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files allowed"));
  },
  limits: { fileSize: 12 * 1024 * 1024 }, // ~12MB hard cap
});

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

      console.log("âœ… checkout.session.completed", {
        email: s.customer_details?.email,
        priceId,
        userId: s.metadata?.userId,
        entryId: s.metadata?.entryId,
        mode: s.mode,
      });

      // If this was a CONTEST payment, email the entry to the inbox
      if (s.mode === "payment" && s.metadata?.entryId) {
        // fallback if JSON file isn't found (e.g., different instance)
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
            console.log("ðŸ“§ Contest entry emailed:", entry.id);
          } catch (e) {
            console.error("Email send error:", e.message);
          }
        } else {
          if (!entry) console.error("âš ï¸ Contest entry not found for entryId:", s.metadata.entryId);
          if (!CONTEST_INBOX) console.error("âš ï¸ CONTEST_INBOX not set; cannot send email.");
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
      console.log("ðŸ’¸ invoice.payment_succeeded", { invoiceId: inv.id, amount: inv.amount_paid });
    }

    res.json({ received: true });
  } catch (e) {
    console.error("Webhook error:", e.message);
    res.status(400).send(`Webhook Error: ${e.message}`);
  }
});

// JSON routes AFTER webhook
app.use(bodyParser.json());

// --- In-memory Users (shared via ./db) ---
let uid = 1;

// Create free account
app.post("/api/users", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).send("Missing fields");

  const exists = [...users.values()].some(
    (u) => (u.email || "").toLowerCase() === String(email).toLowerCase()
  );
  if (exists) return res.status(409).send("Email already registered");

  const user = { id: `u_${uid++}`, name, email, password, avatarUrl: "", bio: "", interests: "" };
  users.set(user.id, user);

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    interests: user.interests,
  });
});

// Basic login (optional)
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
  });
});

// ðŸ”Ž Search users
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
    }));

  res.json(results);
});

// ðŸ”¹ READ ONE USER
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

// Stripe price ids
const PRICE = {
  reader: process.env.STRIPE_PRICE_READER,
  premium: process.env.STRIPE_PRICE_PREMIUM,
  annual: process.env.STRIPE_PRICE_ANNUAL,
};

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

/* ==============================
   CONTEST: upload + $1 checkout
   ============================== */

// 1) Upload a PDF â€” returns { entryId, fileUrl }
app.post("/api/contest/upload", uploadPDF.single("pdf"), (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const userId = String(req.body.userId || "").trim();
    if (!req.file) return res.status(400).send("No file");
    if (!name) return res.status(400).send("Missing name");

    const entryId = `ce_${Date.now()}`;
    const filePath = req.file.path; // absolute path
    const fileUrl = `/uploads/${path.basename(req.file.path)}`;

    saveContestEntry({
      id: entryId,
      name,
      userId: userId || null,
      filePath,
      fileUrl,           // served by backend
      originalName: req.file.originalname || "story.pdf",
      uploadedAt: Date.now(),
      emailed: false,    // set true after email (in webhook)
    });

    res.json({ entryId, fileUrl });
  } catch (e) {
    console.error("upload error:", e.message);
    res.status(500).send("Upload failed");
  }
});

// 2) Create $1 payment session â€” supports either { entryId } (preferred) OR { entry:{...} } legacy
app.post("/api/contest/checkout", async (req, res) => {
  try {
    let entryId = req.body.entryId || null;

    // Legacy shape: { entry: { title, email, genre, text } }
    // We'll still allow it, but the front-end is using entryId flow now.
    if (!entryId && req.body.entry) {
      entryId = `ce_${Date.now()}`;
      // create a minimal "entry" file for legacy (no PDF)
      const fauxPath = path.join(uploadsDir, `${entryId}.txt`);
      fs.writeFileSync(fauxPath, String(req.body.entry.text || "No text"), "utf8");
      saveContestEntry({
        id: entryId,
        name: req.body.entry.title || "Skald Entry",
        userId: null,
        filePath: fauxPath,
        fileUrl: `/uploads/${path.basename(fauxPath)}`,
        originalName: "entry.txt",
        uploadedAt: Date.now(),
        emailed: false,
      });
    }

    if (!entryId) return res.status(400).send("Missing entryId");

    const entry = findContestEntry(entryId);
    if (!entry) return res.status(404).send("Entry not found");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: 100,
            product_data: { name: "Skald Contest Entry", description: entry.name || "Entry" },
          },
          quantity: 1,
        },
      ],
      success_url: `${CLIENT_URL}/#contest-success`,
      cancel_url: `${CLIENT_URL}/#contest-canceled`,
      // include filename + name so webhook can always reconstruct
      metadata: {
        entryId: entry.id,
        userId: entry.userId || "",
        fileBasename: path.basename(entry.filePath || ""),
        entryName: entry.name || "",
      },
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).send("Contest checkout failed");
  }
});

// Manual resend endpoint â€” returns messageId/accepted/response for debugging
app.post("/api/contest/resend", async (req, res) => {
  try {
    const entryId = String(req.body.entryId || "");
    if (!entryId) return res.status(400).json({ ok: false, error: "entryId required" });
    const entry = findContestEntry(entryId);
    if (!entry) return res.status(404).json({ ok: false, error: "Entry not found" });
    const info = await sendContestEmail(entry, null);
    return res.json({
      ok: true,
      resent: entryId,
      messageId: info?.messageId || null,
      accepted: info?.accepted || [],
      response: info?.response || null
    });
  } catch (e) {
    console.error("resend error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Simple test route to verify SMTP without Stripe/webhook
app.post("/api/test/send-email", async (_req, res) => {
  try {
    if (!mailer) return res.status(500).json({ ok: false, error: "Mailer not configured" });
    if (!CONTEST_INBOX) return res.status(400).json({ ok: false, error: "CONTEST_INBOX missing" });

    const info = await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER, // unchanged default
      to: CONTEST_INBOX,
      subject: "[Skald Contest] Mailer test",
      text: "If you received this, SMTP is configured correctly.",
    });
    res.json({ ok: true, id: info.messageId });
  } catch (e) {
    console.error("TEST SEND ERROR:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Debug route to inspect an entry and confirm its file exists
app.get("/api/contest/entry/:id", (req, res) => {
  const entry = findContestEntry(req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: "Entry not found" });
  const exists = entry.filePath ? fs.existsSync(entry.filePath) : false;
  res.json({ ok: true, entry, fileExists: exists });
});

// Health check
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Mount routes
accountRoutes.install(app);
friendsRoutes.install(app);
chatRoutes.install(app);
chatGlobal.install(app);

// --- helper to send email with PDF attached ---
async function sendContestEmail(entry, buyerEmail = null) {
  if (!mailer || !CONTEST_INBOX) {
    console.warn("Mailer not configured or CONTEST_INBOX missing â€” skipping email.");
    return null;
  }

  const attach = [];
  if (entry.filePath && fs.existsSync(entry.filePath)) {
    attach.push({
      filename: entry.originalName || path.basename(entry.filePath),
      path: entry.filePath,
      contentType: "application/pdf",
    });
  }

  const fileLink = entry.fileUrl
    ? `${SERVER_PUBLIC_URL}${entry.fileUrl}`
    : "";

  const html = `
    <div>
      <h2>New Skald Contest Entry</h2>
      <p><strong>Name:</strong> ${entry.name || "Unknown"}</p>
      <p><strong>User ID:</strong> ${entry.userId || "-"}</p>
      ${buyerEmail ? `<p><strong>Buyer Email (Stripe):</strong> ${buyerEmail}</p>` : ""}
      ${fileLink ? `<p><strong>File:</strong> <a href="${fileLink}">${fileLink}</a></p>` : "<p><em>No link available</em></p>"}
      <p>Attached: ${attach.length ? attach[0].filename : "none"}</p>
    </div>
  `;

  const info = await mailer.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER, // unchanged default
    to: CONTEST_INBOX,
    subject: `Skald Contest: ${entry.name || entry.id}`,
    html,
    attachments: attach,
  });

  console.log("[EMAIL] sent", info.messageId, "accepted:", info.accepted, "response:", info.response);

  // mark as emailed
  const arr = readContestEntries();
  const idx = arr.findIndex(e => e.id === entry.id);
  if (idx !== -1) {
    arr[idx].emailed = true;
    writeContestEntries(arr);
  }

  return info; // expose messageId/accepted/response to callers
}

app.listen(PORT, () => console.log(`ðŸ›¡ï¸ Backend listening on ${PORT}`));





















