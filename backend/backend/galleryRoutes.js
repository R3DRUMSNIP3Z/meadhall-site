// backend/backend/galleryRoutes.js
const express = require("express");
// ⬇️ only import from cloudy.js (do NOT require multer-storage-cloudinary here)
const { cloudinary, uploadCloud } = require("./cloudy");

const fs = require("fs");
const path = require("path");

/* ---------- tiny JSON persistence (public_id + url per user) ---------- */
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
  catch { return {}; }
}
function writeStore(store) {
  fs.writeFileSync(dataFile(), JSON.stringify(store, null, 2));
}
function bucketFor(store, uid) {
  if (!store[uid]) store[uid] = { items: [] };
  return store[uid];
}

function install(app) {
  const router = express.Router();
  const getUid = (req) => (req.headers["x-user-id"] || "").toString().trim();

  /* ---------- READ ---------- */
  router.get("/api/users/:id/gallery", (req, res) => {
    const uid = String(req.params.id || "");
    const store = readStore();
    const { items } = bucketFor(store, uid);
    res.json(items);
  });

  router.get("/api/gallery", (req, res) => {
    const uid = String(req.query.user || "");
    if (!uid) return res.status(400).json({ error: "user is required" });
    const store = readStore();
    const { items } = bucketFor(store, uid);
    res.json({ items });
  });

  router.get("/api/account/gallery", (req, res) => {
    const uid = getUid(req);
    if (!uid) return res.status(400).json({ ok: false, error: "Use POST with x-user-id and files" });
    res.json({ ok: true, hint: "POST here with field 'photos' or 'photo[]' and header x-user-id" });
  });

  /* ---------- CREATE (UPLOAD) ---------- */
  // Accept BOTH "photos" and "photo[]"
  router.post(
    "/api/account/gallery",
    (req, res, next) => uploadCloud.array("photos", 20)(req, res, (err) => {
      if (err && err.message !== "Unexpected field") return next(err);
      if (!req.files || req.files.length === 0) {
        return uploadCloud.array("photo[]", 20)(req, res, next);
      }
      next();
    }),
    (req, res) => {
      const uid = getUid(req);
      if (!uid) return res.status(401).json({ error: "Missing user id (x-user-id)" });
      if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

      // Cloudinary: file.path = secure URL, file.filename = public_id
      const store = readStore();
      const bucket = bucketFor(store, uid);

      const added = req.files.map((f) => ({
        id: f.filename,       // public_id
        url: f.path,          // secure URL
        createdAt: Date.now(),
      }));

      bucket.items.push(...added);
      writeStore(store);

      res.json({ ok: true, items: added });
    }
  );

  /* ---------- DELETE ---------- */
  router.delete("/api/users/:id/gallery/:photoId", async (req, res) => {
    const uid = String(req.params.id || "");
    const photoId = decodeURIComponent(String(req.params.photoId || "")); // Cloudinary public_id

    const store = readStore();
    const bucket = bucketFor(store, uid);

    const idx = bucket.items.findIndex((p) => String(p.id) === String(photoId));
    if (idx === -1) return res.status(404).json({ error: "Photo not found" });

    const [removed] = bucket.items.splice(idx, 1);
    writeStore(store);

    try { await cloudinary.uploader.destroy(removed.id, { resource_type: "image" }); } catch (_) {}

    return res.status(204).end();
  });

  router.use((err, _req, res, _next) => {
    const msg = err?.message || String(err);
    const code = /file|multer|cloudinary/i.test(msg) ? 400 : 500;
    res.status(code).json({ error: msg });
  });

  app.use(router);
}

module.exports = { install };













