// backend/backend/galleryRoutes.js (CommonJS)
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

/* ---------- tiny JSON persistence ---------- */
function dataDir() {
  return path.join(__dirname, "data");
}
function dataFile() {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "gallery.json");
}
function readStore() {
  try { return JSON.parse(fs.readFileSync(dataFile(), "utf8")); }
  catch { return {}; } // { [userId]: { items: [ {id, url, createdAt} ] } }
}
function writeStore(store) {
  fs.writeFileSync(dataFile(), JSON.stringify(store, null, 2));
}
function bucketFor(store, userId) {
  if (!store[userId]) store[userId] = { items: [] };
  return store[userId];
}

/* ---------- installer ---------- */
function install(app) {
  const router = express.Router();

  // Use the SAME uploads dir index.js exposes at /uploads
  const uploadRoot = app.locals?.uploadsDir || path.join(__dirname, "public", "uploads");
  fs.mkdirSync(uploadRoot, { recursive: true });

  // Public base (absolute URLs)
  const BASE = (process.env.SERVER_PUBLIC_URL || "").replace(/\/+$/, "");
  const urlFor = (filename) => BASE ? `${BASE}/uploads/${filename}` : `/uploads/${filename}`;

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
    limits: { fileSize: 12 * 1024 * 1024 }, // 12MB per image
    fileFilter: (_req, file, cb) => {
      if (/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.mimetype)) cb(null, true);
      else cb(new Error("Only image files are allowed"));
    },
  });

  const getUid = (req) => (req.headers["x-user-id"] || "").toString().trim();
  const toItem = (fn) => ({ id: fn, url: urlFor(fn), createdAt: Date.now() });

  /* ---------- READ ---------- */
  // Main: list a user's gallery (array of items)
  router.get("/api/users/:id/gallery", (req, res) => {
    const userId = String(req.params.id || "");
    const store = readStore();
    const { items } = bucketFor(store, userId);
    return res.json(items);
  });

  // Alias used by the frontend's fallback
  router.get("/api/gallery", (req, res) => {
    const userId = String(req.query.user || "");
    if (!userId) return res.status(400).json({ error: "user is required" });
    const store = readStore();
    const { items } = bucketFor(store, userId);
    return res.json({ items });
  });

  // Helper for quick sanity checks in a browser
  router.get("/api/account/gallery", (req, res) => {
    const uid = getUid(req);
    if (!uid) return res.status(400).json({ ok: false, error: "Use POST with x-user-id and files" });
    return res.json({ ok: true, hint: "POST here with field 'photos' or 'photo[]' and header x-user-id" });
  });

  /* ---------- CREATE (UPLOAD) ---------- */
  // Accept BOTH field names: "photos" and "photo[]"
  router.post(
    "/api/account/gallery",
    (req, res, next) => upload.array("photos", 20)(req, res, (err) => {
      if (err && err.message !== "Unexpected field") return next(err);
      if (!req.files || req.files.length === 0) {
        return upload.array("photo[]", 20)(req, res, next);
      }
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
        const item = toItem(filename);
        bucket.items.push(item);
        added.push(item);
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

    // Best-effort file delete (safe: only within uploads folder)
    const fp = path.join(uploadRoot, path.basename(removed.url || removed.id || photoId));
    fs.promises.unlink(fp).catch(() => { /* ignore */ });

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





