// backend/galleryRoutes.js — Cloudinary-backed uploads + absolute URLs in responses
const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");

// Cloudinary storage
const { cloudinary } = require("./cloudy");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

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
// Public base like "https://meadhall-site.onrender.com"
function publicBase(req) {
  const fromEnv = (process.env.SERVER_PUBLIC_URL || "").replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}
const isAbs = (u) => /^https?:\/\//i.test(u);
const isCloudUrl = (u = "") => /(?:res\.cloudinary\.com|cloudinary\.com)/i.test(u);
const relUpload = (fn) => `/uploads/${fn}`;

// Accept user id from header, param, query, or body
const getUid = (req) => {
  const h = (req.headers["x-user-id"] || "").toString().trim();
  if (h) return h;
  if (req.params?.id) return String(req.params.id).trim();
  if (req.query?.user) return String(req.query.user).trim();
  if (req.body?.userId) return String(req.body.userId).trim();
  return "";
};

// Ensure every item we return has an ABSOLUTE url for the frontend (no-op for Cloudinary)
function withAbsoluteUrl(req, item) {
  if (isAbs(item.url)) return item;
  const base = publicBase(req);
  return { ...item, url: `${base}${item.url}` };
}

/* ---------- installer ---------- */
function install(app) {
  const router = express.Router();

  // Local uploads dir still exists for other features (avatars, PDFs, legacy cleanup)
  const uploadRoot = app.locals?.uploadsDir || path.join(__dirname, "public", "uploads");
  fs.mkdirSync(uploadRoot, { recursive: true });

  // ----- Cloudinary storage for gallery -----
  const storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => {
      const uid = getUid(req) || "anonymous";
      return {
        folder: `meadhall/gallery/${uid}`,
        resource_type: "image",
        allowed_formats: ["png", "jpg", "jpeg", "webp", "gif", "avif"],
        use_filename: false,
        unique_filename: true,
        overwrite: false,
        // Optional: limit originals a bit to keep usage sane
        // transformation: [{ width: 2000, height: 2000, crop: "limit" }],
      };
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

  /* ---------- READ ---------- */
  router.get("/api/users/:id/gallery", (req, res) => {
    const userId = String(req.params.id || "");
    const store = readStore();
    const { items } = bucketFor(store, userId);
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

  /* ---------- CREATE (UPLOAD via Cloudinary) ---------- */
  function handleUpload(req, res) {
    const userId = getUid(req);
    if (!userId) return res.status(401).json({ error: "Missing user id" });
    if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

    const store = readStore();
    const bucket = bucketFor(store, userId);

    const added = [];
    for (const f of req.files) {
      // multer-storage-cloudinary v4 provides:
      // f.path (secure URL), f.filename (public_id)
      const publicId = String(f.filename || f.public_id || "").trim();
      const url = String(f.path || f.secure_url || f.url || "").trim();
      if (!publicId || !url) continue;

      const item = {
        id: publicId,         // use Cloudinary public_id as our stable id
        publicId,
        url,                  // absolute Cloudinary secure_url
        createdAt: Date.now(),
      };
      bucket.items.push(item);
      added.push(item);
    }

    writeStore(store);
    // Already absolute for Cloudinary; keep helper for legacy parity
    return res.json({ ok: true, items: added.map((it) => withAbsoluteUrl(req, it)) });
  }

  // Accept both field names: photos, photo[]
  router.post(
    "/api/account/gallery",
    (req, res, next) => upload.array("photos", 20)(req, res, (err) => {
      if (err && err.message !== "Unexpected field") return next(err);
      if (!req.files || req.files.length === 0) return upload.array("photo[]", 20)(req, res, next);
      next();
    }),
    handleUpload
  );

  // Param-style alias: POST /api/users/:id/gallery (no need for x-user-id header)
  router.post(
    "/api/users/:id/gallery",
    (req, res, next) => upload.array("photos", 20)(req, res, (err) => {
      if (err && err.message !== "Unexpected field") return next(err);
      if (!req.files || req.files.length === 0) return upload.array("photo[]", 20)(req, res, next);
      next();
    }),
    handleUpload
  );

  /* ---------- DELETE ---------- */
  router.delete("/api/users/:id/gallery/:photoId", async (req, res) => {
    const userId = String(req.params.id || "");
    const photoId = decodeURIComponent(String(req.params.photoId || ""));

    const store = readStore();
    const bucket = bucketFor(store, userId);

    const idx = bucket.items.findIndex((p) => String(p.id) === String(photoId));
    if (idx === -1) return res.status(404).json({ error: "Photo not found" });

    const [removed] = bucket.items.splice(idx, 1);
    writeStore(store);

    // Try Cloudinary delete (preferred); fall back to local unlink for legacy items
    try {
      if (removed && (removed.publicId || isCloudUrl(removed.url))) {
        const pid = removed.publicId || removed.id;
        await cloudinary.uploader.destroy(pid, { resource_type: "image" });
      } else {
        const fileName = removed?.id || path.basename(removed?.url || "");
        fs.promises.unlink(path.join(uploadRoot, fileName)).catch(() => {});
      }
    } catch (e) {
      console.warn("Delete issue (cloud/local):", e && e.message);
      // not fatal; item already removed from store
    }

    return res.status(204).end();
  });

  /* ---------- error → readable JSON ---------- */
  router.use((err, _req, res, _next) => {
    const msg = err?.message || String(err);
    const code = /file|multer|cloudinary/i.test(msg) ? 400 : 500;
    const pretty = /File too large/i.test(msg) ? "Image exceeds 12MB limit" : msg;
    return res.status(code).json({ error: pretty });
  });

  app.use(router);
}

module.exports = { install };


















