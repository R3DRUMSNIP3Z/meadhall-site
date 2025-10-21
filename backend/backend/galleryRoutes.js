// backend/backend/galleryRoutes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { cloudinary, HAVE_CLOUD } = require("./cloudy");
let CloudinaryStorage = null;
try {
  CloudinaryStorage = require("multer-storage-cloudinary").CloudinaryStorage;
} catch (_) { /* ok when no cloudinary storage */ }

/* ---------- tiny JSON persistence ---------- */
function dataDir() { return path.join(__dirname, "data"); }
function dataFile() {
  const dir = dataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "gallery.json");
}
function readStore() {
  try { return JSON.parse(fs.readFileSync(dataFile(), "utf8")); }
  catch { return {}; } // { [uid]: { items: [ {id,url,createdAt} ] } }
}
function writeStore(store) { fs.writeFileSync(dataFile(), JSON.stringify(store, null, 2)); }
function bucketFor(store, uid) { if (!store[uid]) store[uid] = { items: [] }; return store[uid]; }

/* ---------- installer ---------- */
function install(app) {
  const router = express.Router();

  // Shared uploads dir (same one index.js serves at /uploads)
  const uploadRoot = app.locals?.uploadsDir || path.join(__dirname, "public", "uploads");
  fs.mkdirSync(uploadRoot, { recursive: true });

  const getUid = (req) => (req.headers["x-user-id"] || "").toString().trim();

  // Pick storage: Cloudinary (if configured) or disk
  let storage;
  if (HAVE_CLOUD && CloudinaryStorage) {
    storage = new CloudinaryStorage({
      cloudinary,
      params: async (_req, file) => {
        const base = String(file.originalname || "photo")
          .replace(/\.[^.]+$/, "")
          .replace(/\s+/g, "_");
        return {
          folder: "meadhall/gallery",
          resource_type: "image",
          public_id: `${Date.now()}-${base}`,
          overwrite: false,
        };
      },
    });
    console.log("📸 Gallery storage: Cloudinary");
  } else {
    storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadRoot),
      filename: (_req, file, cb) => {
        const safe = String(file.originalname || "photo").replace(/\s+/g, "_");
        cb(null, `${Date.now()}-${safe}`);
      },
    });
    console.log("📸 Gallery storage: Local disk (/uploads)");
  }

  const upload = multer({
    storage,
    limits: { fileSize: 12 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.mimetype)) cb(null, true);
      else cb(new Error("Only image files are allowed"));
    },
  });

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

  // Helper sanity endpoint
  router.get("/api/account/gallery", (req, res) => {
    const uid = getUid(req);
    return res.json({
      ok: true,
      haveUser: !!uid,
      storage: HAVE_CLOUD ? "cloudinary" : "disk",
      hint: "POST here with header x-user-id and field 'photos' (or 'photo[]')",
    });
  });

  /* ---------- CREATE (UPLOAD) ---------- */
  router.post(
    "/api/account/gallery",
    // Try 'photos' first, then 'photo[]'
    (req, res, next) => upload.array("photos", 20)(req, res, (err) => {
      if (err && err.message !== "Unexpected field") return next(err);
      if (!req.files || req.files.length === 0) {
        return upload.array("photo[]", 20)(req, res, next);
      }
      next();
    }),
    async (req, res) => {
      const uid = getUid(req);
      if (!uid) return res.status(401).json({ error: "Missing user id (x-user-id)" });
      if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

      const store = readStore();
      const bucket = bucketFor(store, uid);

      const added = req.files.map((f) => {
        if (HAVE_CLOUD) {
          // Cloudinary: f.path (secure URL), f.filename (public_id)
          return { id: f.filename, url: f.path, createdAt: Date.now() };
        } else {
          // Disk: f.filename saved under /uploads
          return { id: f.filename, url: `/uploads/${f.filename}`, createdAt: Date.now() };
        }
      });

      bucket.items.push(...added);
      writeStore(store);
      res.json({ ok: true, items: added });
    }
  );

  /* ---------- DELETE ---------- */
  router.delete("/api/users/:id/gallery/:photoId", async (req, res) => {
    const uid = String(req.params.id || "");
    const photoId = decodeURIComponent(String(req.params.photoId || ""));

    const store = readStore();
    const bucket = bucketFor(store, uid);

    const idx = bucket.items.findIndex((p) => String(p.id) === String(photoId));
    if (idx === -1) return res.status(404).json({ error: "Photo not found" });

    const [removed] = bucket.items.splice(idx, 1);
    writeStore(store);

    // Delete from storage
    if (HAVE_CLOUD) {
      try { await cloudinary.uploader.destroy(removed.id, { resource_type: "image" }); } catch (_) {}
    } else {
      try { fs.unlinkSync(path.join(uploadRoot, removed.id)); } catch (_) {}
    }

    return res.status(204).end();
  });

  /* ---------- error → readable JSON ---------- */
  router.use((err, _req, res, _next) => {
    console.error("gallery error:", err && (err.stack || err.message || err));
    const msg = err?.message || String(err);
    const code = /file|multer|cloudinary/i.test(msg) ? 400 : 500;
    res.status(code).json({ error: msg });
  });

  app.use(router);
}

module.exports = { install };














