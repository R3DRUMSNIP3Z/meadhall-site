// backend/galleryRoutes.js (Cloudinary version, CommonJS)
const express = require("express");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { cloudinary } = require("./cloudy");

/* ---------- tiny JSON persistence (public_id + url per user) ---------- */
const fs = require("fs");
const path = require("path");

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
function bucketFor(store, uid) {
  if (!store[uid]) store[uid] = { items: [] };
  return store[uid];
}

/* ---------- installer ---------- */
function install(app) {
  const router = express.Router();

  // Cloudinary storage for gallery
  const galleryStorage = new CloudinaryStorage({
    cloudinary,
    params: async (_req, file) => {
      const base = String(file.originalname || "photo").replace(/\.[^.]+$/, "").replace(/\s+/g, "_");
      return {
        folder: "meadhall/gallery",
        resource_type: "image",
        public_id: `${Date.now()}-${base}`,
        overwrite: false,
      };
    },
  });
  const upload = multer({
    storage: galleryStorage,
    limits: { fileSize: 12 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.mimetype)) cb(null, true);
      else cb(new Error("Only image files are allowed"));
    },
  });

  const getUid = (req) => (req.headers["x-user-id"] || "").toString().trim();

  /* ---------- READ ---------- */
  router.get("/api/users/:id/gallery", (req, res) => {
    const uid = String(req.params.id || "");
    const store = readStore();
    const { items } = bucketFor(store, uid);
    res.json(items);
  });

  // alias used by the frontend’s fallback
  router.get("/api/gallery", (req, res) => {
    const uid = String(req.query.user || "");
    if (!uid) return res.status(400).json({ error: "user is required" });
    const store = readStore();
    const { items } = bucketFor(store, uid);
    res.json({ items });
  });

  // Helper (sanity)
  router.get("/api/account/gallery", (req, res) => {
    const uid = getUid(req);
    if (!uid) return res.status(400).json({ ok: false, error: "Use POST with x-user-id and files" });
    res.json({ ok: true, hint: "POST here with field 'photos' or 'photo[]' and header x-user-id" });
  });

  /* ---------- CREATE (UPLOAD) ---------- */
  // Accept BOTH field names: "photos" and "photo[]"
  router.post(
    "/api/account/gallery",
    // first try 'photos'
    (req, res, next) => upload.array("photos", 20)(req, res, (err) => {
      if (err && err.message !== "Unexpected field") return next(err);
      if (!req.files || req.files.length === 0) {
        // then try 'photo[]'
        return upload.array("photo[]", 20)(req, res, next);
      }
      next();
    }),
    (req, res) => {
      const uid = getUid(req);
      if (!uid) return res.status(401).json({ error: "Missing user id (x-user-id)" });
      if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

      // For Cloudinary storage, each file has:
      // - file.path      => secure URL
      // - file.filename  => public_id
      const store = readStore();
      const bucket = bucketFor(store, uid);

      const added = req.files.map((f) => ({
        id: f.filename,
        url: f.path,
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
    const photoId = decodeURIComponent(String(req.params.photoId || "")); // this is Cloudinary public_id

    const store = readStore();
    const bucket = bucketFor(store, uid);

    const idx = bucket.items.findIndex((p) => String(p.id) === String(photoId));
    if (idx === -1) return res.status(404).json({ error: "Photo not found" });

    const [removed] = bucket.items.splice(idx, 1);
    writeStore(store);

    // delete from Cloudinary (ignore failures)
    try {
      await cloudinary.uploader.destroy(removed.id, { resource_type: "image" });
    } catch (_) {}

    return res.status(204).end();
  });

  /* ---------- error -> readable JSON ---------- */
  router.use((err, _req, res, _next) => {
    const msg = err?.message || String(err);
    const code = /file|multer|cloudinary/i.test(msg) ? 400 : 500;
    res.status(code).json({ error: msg });
  });

  app.use(router);
}

module.exports = { install };












