// backend/galleryRoutes.js (CommonJS) — absolute URLs based on request + JSON store
const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");

/* ---------- tiny JSON persistence ---------- */
function dataDir()  { return path.join(__dirname, "data"); }
function dataFile() {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "gallery.json");
}
function readStore() { try { return JSON.parse(fs.readFileSync(dataFile(), "utf8")); } catch { return {}; } }
function writeStore(store) { fs.writeFileSync(dataFile(), JSON.stringify(store, null, 2)); }
function bucketFor(store, userId) {
  if (!store[userId]) store[userId] = { items: [] };
  return store[userId];
}

/* ---------- helpers ---------- */
// Build a public base like "https://meadhall-site.onrender.com"
function publicBase(req) {
  const fromEnv = (process.env.SERVER_PUBLIC_URL || "").replace(/\/+$/,"");
  if (fromEnv) return fromEnv;
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}
const isAbs = (u) => /^https?:\/\//i.test(u);
const relUpload = (fn) => `/uploads/${fn}`;

/* ---------- installer ---------- */
function install(app) {
  const router = express.Router();

  // Use SAME uploads dir as index.js
  const uploadRoot = app.locals?.uploadsDir || path.join(__dirname, "public", "uploads");
  fs.mkdirSync(uploadRoot, { recursive: true });

  // Multer config
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot),
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || "photo").replace(/\s+/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: 12 * 1024 * 1024 }, // 12MB
    fileFilter: (_req, file, cb) =>
      /^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.mimetype)
        ? cb(null, true)
        : cb(new Error("Only image files are allowed")),
  });

  const getUid = (req) => (req.headers["x-user-id"] || "").toString().trim();

  // Ensure every item we return has an ABSOLUTE url for the frontend
  function withAbsoluteUrl(req, item) {
    if (isAbs(item.url)) return item;
    const base = publicBase(req);
    return { ...item, url: `${base}${item.url}` };
  }

  /* ---------- READ ---------- */
  router.get("/api/users/:id/gallery", (req, res) => {
    const userId = String(req.params.id || "");
    const store = readStore();
    const { items } = bucketFor(store, userId);
    // Always respond with absolute URLs
    return res.json(items.map((it) => withAbsoluteUrl(req, it)));
  });

  // Alias used by some clients
  router.get("/api/gallery", (req, res) => {
    const userId = String(req.query.user || "");
    if (!userId) return res.status(400).json({ error: "user is required" });
    const store = readStore();
    const { items } = bucketFor(store, userId);
    return res.json({ items: items.map((it) => withAbsoluteUrl(req, it)) });
  });

  // Helper for sanity checks
  router.get("/api/account/gallery", (req, res) => {
    const uid = getUid(req);
    if (!uid) return res.status(400).json({ ok: false, error: "Use POST with x-user-id and files" });
    return res.json({ ok: true, hint: "POST here with field 'photos' or 'photo[]' and header x-user-id" });
  });

  /* ---------- CREATE (UPLOAD) ---------- */
  // Accept both field names: photos, photo[]
  router.post(
    "/api/account/gallery",
    (req, res, next) => upload.array("photos", 20)(req, res, (err) => {
      if (err && err.message !== "Unexpected field") return next(err);
      if (!req.files || req.files.length === 0) return upload.array("photo[]", 20)(req, res, next);
      next();
    }),
    (req, res) => {
      const userId = getUid(req);
      if (!userId) return res.status(401).json({ error: "Missing user id (x-user-id)" });
      if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

      const store = readStore();
      const bucket = bucketFor(store, userId);

      const added = [];
      for (const f of req.files) {
        const filename = path.basename(f.path);
        // Store RELATIVE url so the file can be moved or base can change
        const item = { id: filename, url: relUpload(filename), createdAt: Date.now() };
        bucket.items.push(item);
        added.push(withAbsoluteUrl(req, item)); // respond with absolute for convenience
      }

      writeStore(store);
      return res.json({ ok: true, items: added });
    }
  );

  /* ---------- DELETE ---------- */
  router.delete("/api/users/:id/gallery/:photoId", (req, res) => {
    const userId = String(req.params.id || "");
    const photoId = decodeURIComponent(String(req.params.photoId || ""));

    const store = readStore();
    const bucket = bucketFor(store, userId);

    const idx = bucket.items.findIndex((p) => String(p.id) === String(photoId));
    if (idx === -1) return res.status(404).json({ error: "Photo not found" });

    const [removed] = bucket.items.splice(idx, 1);
    writeStore(store);

    // Best-effort file delete
    const fileName = removed?.id || path.basename(removed?.url || "");
    fs.promises.unlink(path.join(uploadRoot, fileName)).catch(() => {});
    return res.status(204).end();
  });

  /* ---------- error → readable JSON ---------- */
  router.use((err, _req, res, _next) => {
    const msg = err?.message || String(err);
    const code = /file|multer/i.test(msg) ? 400 : 500;
    return res.status(code).json({ error: msg });
  });

  app.use(router);
}

module.exports = { install };











