// backend/index.js — full server with email-code signup + login + uploads + contest

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
const accountRoutes = require("./accountRoutes");
const friendsRoutes = require("./friendsRoutes");
const chatRoutes = require("./chatRoutes");
const chatGlobal = require("./chatGlobal");

const app = express();

/* -------------------- env -------------------- */
const CLIENT_URL =
  process.env.CLIENT_URL || "http://localhost:5173"; // <-- on Render set to your Vercel URL
const PORT = Number(process.env.PORT || 5050);
const STRIPE_SECRET = process.env.STRIPE_SECRET || "";
const stripe = new Stripe(STRIPE_SECRET || "sk_test_dummy", { apiVersion: "2024-06-20" });

const SERVER_PUBLIC_URL =
  process.env.SERVER_PUBLIC_URL || `http://localhost:${PORT}`; // <-- on Render set to your Render URL
const CONTEST_INBOX = process.env.CONTEST_INBOX || "";
const VERIFY_DEBUG = String(process.env.VERIFY_DEBUG || "false") === "true";

/* -------------------- CORS -------------------- */
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
      cb(null, allowedOrigins.has(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Stripe-Signature", "x-user-id"],
    maxAge: 86400,
  })
);
app.options(/.*/, cors());
app.set("trust proxy", 1);

/* -------------------- static uploads -------------------- */
const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

/* -------------------- tiny JSON “db” -------------------- */
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const PURCHASES_FILE = path.join(DATA_DIR, "purchases.json");
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

const CONTEST_FILE = path.join(DATA_DIR, "contest_entries.json");
if (!fs.existsSync(CONTEST_FILE)) fs.writeFileSync(CONTEST_FILE, "[]");
const readContestEntries = () => {
  try { return JSON.parse(fs.readFileSync(CONTEST_FILE, "utf8")); } catch { return []; }
};
const writeContestEntries = (arr) => fs.writeFileSync(CONTEST_FILE, JSON.stringify(arr, null, 2));
const saveContestEntry = (entry) => { const a = readContestEntries(); a.push(entry); writeContestEntries(a); };
const findContestEntry = (id) => readContestEntries().find(e => String(e.id) === String(id)) || null;

/* -------------------- Nodemailer -------------------- */
let mailer = null;
if (process.env.SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  mailer.verify()
    .then(() => console.log("📨 SMTP ready:", process.env.SMTP_HOST))
    .catch(err => console.error("❌ SMTP verify failed:", err.message));
}

/* -------------------- Multer: contest PDFs -------------------- */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${String(file.originalname||"file").replace(/\s+/g,"_")}`),
});
const uploadPDF = multer({
  storage,
  fileFilter: (_req, file, cb) =>
    file.mimetype === "application/pdf" ? cb(null, true) : cb(new Error("Only PDF files allowed")),
  limits: { fileSize: 12 * 1024 * 1024 },
});

/* -------------------- Stripe webhook BEFORE JSON -------------------- */
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
      } catch (e) { console.warn("listLineItems failed:", e.message); }

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

      if (s.mode === "payment" && s.metadata?.entryId) {
        let entry = findContestEntry(s.metadata.entryId);
        if (!entry && s.metadata?.fileBasename) {
          const fn = s.metadata.fileBasename;
          entry = {
            id: s.metadata.entryId,
            name: s.metadata.entryName || "Skald Entry",
            userId: s.metadata.userId || null,
            filePath: path.join(uploadsDir, fn),
            fileUrl: `/uploads/${fn}`,
            originalName: fn,
            uploadedAt: Date.now(),
            emailed: false,
          };
        }
        if (entry && CONTEST_INBOX) {
          try { await sendContestEmail(entry, s.customer_details?.email || s.customer_email || null); }
          catch (e) { console.error("Email send error:", e.message); }
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
    }

    res.json({ received: true });
  } catch (e) {
    console.error("Webhook error:", e.message);
    res.status(400).send(`Webhook Error: ${e.message}`);
  }
});

/* -------------------- JSON after webhook -------------------- */
app.use(bodyParser.json());

/* -------------------- AUTH: email code endpoints (NEW) -------------------- */
// memory store: { code, exp } keyed by email
const verifyCodes = new Map(); // email -> { code, expMs }

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
async function sendCodeEmail(email, code) {
  if (!mailer) return false;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const info = await mailer.sendMail({
    from,
    to: email,
    subject: "Your Mead Hall verification code",
    text: `Your code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
  });
  console.log("📧 sent code to", email, info.messageId);
  return true;
}

// Request a 6-digit code
app.post("/api/auth/request-code", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email required" });

    const code = makeCode();
    verifyCodes.set(email, { code, exp: Date.now() + 10 * 60 * 1000 }); // 10 min

    let sent = false;
    try {
      if (mailer) sent = await sendCodeEmail(email, code);
    } catch (e) {
      console.error("sendCodeEmail error:", e.message);
    }

    // In dev/VERIFY_DEBUG, echo the code so the UI can display it
    return res.json({
      ok: true,
      sent,
      ...(VERIFY_DEBUG || !mailer ? { code } : {}), // expose only in debug or when mailer missing
    });
  } catch (e) {
    console.error("request-code error:", e.message);
    res.status(500).json({ error: "Failed to send code" });
  }
});

// Confirm a code
app.post("/api/auth/confirm", (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();
    if (!email || !code) return res.status(400).json({ error: "Email and code required" });

    const rec = verifyCodes.get(email);
    if (!rec) return res.status(400).json({ error: "No code requested" });
    if (Date.now() > rec.exp) { verifyCodes.delete(email); return res.status(400).json({ error: "Code expired" }); }
    if (rec.code !== code) return res.status(400).json({ error: "Invalid code" });

    verifyCodes.delete(email);
    return res.json({ ok: true });
  } catch (e) {
    console.error("confirm error:", e.message);
    res.status(500).json({ error: "Confirm failed" });
  }
});

/* -------------------- Users -------------------- */
let uid = 1;

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
    id: user.id, name: user.name, email: user.email,
    avatarUrl: user.avatarUrl, bio: user.bio, interests: user.interests,
  });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).send("Missing credentials");
  const match = [...users.values()].find(
    (u) => (u.email || "").toLowerCase() === String(email).toLowerCase() && u.password === password
  );
  if (!match) return res.status(401).send("Invalid credentials");
  res.json({
    id: match.id, name: match.name, email: match.email,
    avatarUrl: match.avatarUrl, bio: match.bio, interests: match.interests,
  });
});

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
      id: u.id, name: u.name, email: u.email,
      avatarUrl: u.avatarUrl || "", bio: u.bio || "", interests: u.interests || "",
    }));
  res.json(results);
});

app.get("/api/users/:id", (req, res) => {
  const u = users.get(req.params.id);
  if (!u) return res.status(404).json({ error: "User not found" });
  res.json({
    id: u.id, name: u.name, email: u.email,
    avatarUrl: u.avatarUrl || "", bio: u.bio || "", interests: u.interests || "",
  });
});

/* -------------------- Subscriptions -------------------- */
const PRICE = {
  reader: process.env.STRIPE_PRICE_READER,
  premium: process.env.STRIPE_PRICE_PREMIUM,
  annual: process.env.STRIPE_PRICE_ANNUAL,
};

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

/* -------------------- Contest: upload + $1 -------------------- */
app.post("/api/contest/upload", uploadPDF.single("pdf"), (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const userId = String(req.body.userId || "").trim();
    if (!req.file) return res.status(400).send("No file");
    if (!name) return res.status(400).send("Missing name");

    const entryId = `ce_${Date.now()}`;
    const filePath = req.file.path;
    const fileUrl = `/uploads/${path.basename(req.file.path)}`;

    saveContestEntry({
      id: entryId, name, userId: userId || null,
      filePath, fileUrl, originalName: req.file.originalname || "story.pdf",
      uploadedAt: Date.now(), emailed: false,
    });

    res.json({ entryId, fileUrl });
  } catch (e) {
    console.error("upload error:", e.message);
    res.status(500).send("Upload failed");
  }
});

app.post("/api/contest/checkout", async (req, res) => {
  try {
    let entryId = req.body.entryId || null;
    if (!entryId && req.body.entry) {
      entryId = `ce_${Date.now()}`;
      const fauxPath = path.join(uploadsDir, `${entryId}.txt`);
      fs.writeFileSync(fauxPath, String(req.body.entry.text || "No text"), "utf8");
      saveContestEntry({
        id: entryId, name: req.body.entry.title || "Skald Entry", userId: null,
        filePath: fauxPath, fileUrl: `/uploads/${path.basename(fauxPath)}`,
        originalName: "entry.txt", uploadedAt: Date.now(), emailed: false,
      });
    }
    if (!entryId) return res.status(400).send("Missing entryId");

    const entry = findContestEntry(entryId);
    if (!entry) return res.status(404).send("Entry not found");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: 100,
          product_data: { name: "Skald Contest Entry", description: entry.name || "Entry" },
        },
        quantity: 1,
      }],
      success_url: `${CLIENT_URL}/#contest-success`,
      cancel_url: `${CLIENT_URL}/#contest-canceled`,
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

app.post("/api/contest/resend", async (req, res) => {
  try {
    const entryId = String(req.body.entryId || "");
    if (!entryId) return res.status(400).json({ ok: false, error: "entryId required" });
    const entry = findContestEntry(entryId);
    if (!entry) return res.status(404).json({ ok: false, error: "Entry not found" });
    const info = await sendContestEmail(entry, null);
    return res.json({ ok: true, resent: entryId, messageId: info?.messageId || null, accepted: info?.accepted || [], response: info?.response || null });
  } catch (e) {
    console.error("resend error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/contest/entry/:id", (req, res) => {
  const entry = findContestEntry(req.params.id);
  if (!entry) return res.status(404).json({ ok: false, error: "Entry not found" });
  const exists = entry.filePath ? fs.existsSync(entry.filePath) : false;
  res.json({ ok: true, entry, fileExists: exists });
});

/* -------------------- Avatar upload (NEW) -------------------- */
const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${String(file.originalname||"avatar.png").replace(/\s+/g,"_")}`),
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    /^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype) ? cb(null, true) : cb(new Error("Only image files are allowed")),
});
app.post("/api/account/avatar", uploadAvatar.single("avatar"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  return res.json({ url: `/uploads/${req.file.filename}` });
});

/* -------------------- misc -------------------- */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

accountRoutes.install(app);
friendsRoutes.install(app);
chatRoutes.install(app);
chatGlobal.install(app);

/* -------------------- helpers -------------------- */
async function sendContestEmail(entry, buyerEmail = null) {
  if (!mailer || !CONTEST_INBOX) {
    console.warn("Mailer not configured or CONTEST_INBOX missing — skipping email.");
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
  const fileLink = entry.fileUrl ? `${SERVER_PUBLIC_URL}${entry.fileUrl}` : "";
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
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: CONTEST_INBOX,
    subject: `Skald Contest: ${entry.name || entry.id}`,
    html,
    attachments: attach,
  });
  const arr = readContestEntries();
  const idx = arr.findIndex(e => e.id === entry.id);
  if (idx !== -1) { arr[idx].emailed = true; writeContestEntries(arr); }
  return info;
}

/* -------------------- start -------------------- */
app.listen(PORT, () => console.log(`🛡️ Backend listening on ${PORT}`));
































