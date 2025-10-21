// backend/backend/galleryRoutes.js (CommonJS)
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

function install(app) {
  const router = express.Router();

  // Same uploads folder the server exposes at /uploads
  const uploadRoot = app.locals?.uploadsDir || path.join(__dirname, "public", "uploads");
  fs.mkdirSync(uploadRoot, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot),
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || "photo").replace(/\s+/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: 12 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.mimetype)) cb(null, true);
      else cb(new Error("Only image files are allowed"));
    },
  });

  // In-memory map (persists files on disk; list resets on restart)
  const gallery = app.locals.galleryMap || (app.locals.galleryMap = new Map());
  const getUid = (req) => (req.headers["x-user-id"] || "").toString().trim();
  const toItem = (fn) => ({ id: fn, url: `/uploads/${fn}`, createdAt: Date.now() });

  // ---------- READ ----------
  router.get("/api/users/:id/gallery", (req, res) => {
    const uid = String(req.params.id || "");
    return res.json(gallery.get(uid) || []);
  });

  // Alias used by frontend fallback
  router.get("/api/gallery", (req, res) => {
    const uid = String(req.query.user || "");
    if (!uid) return res.status(400).json({ error: "user is required" });
    return res.json({ items: gallery.get(uid) || [] });
  });

  // ✅ GET helper for quick browser sanity checks
  router.get("/api/account/gallery", (req, res) => {
    const uid = getUid(req);
    if (!uid) return res.status(400).json({ ok: false, error: "Use POST with x-user-id and files" });
    return res.json({ ok: true, hint: "POST here with field 'photos' or 'photo[]' and header x-user-id" });
  });

  // ---------- CREATE (UPLOAD) ----------
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
      const uid = getUid(req);
      if (!uid) return res.status(401).json({ error: "Missing user id (x-user-id)" });
      if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

      const curr = gallery.get(uid) || [];
      const added = [];
      for (const f of req.files) {
        const item = toItem(f.filename);
        curr.push(item);
        added.push(item);
      }
      gallery.set(uid, curr);
      return res.json({ ok: true, items: added });
    }
  );

  // ---------- DELETE ----------
  router.delete("/api/users/:id/gallery/:photoId", (req, res) => {
    const { id: uid, photoId } = req.params;
    const curr = gallery.get(uid) || [];
    const next = curr.filter((p) => String(p.id) !== String(photoId));
    gallery.set(uid, next);
    try { fs.unlinkSync(path.join(uploadRoot, photoId)); } catch {}
    return res.status(204).end();
  });

  // Multer / other errors → readable JSON
  router.use((err, _req, res, _next) => {
    const msg = err?.message || String(err);
    const code = /file/i.test(msg) ? 400 : 500;
    return res.status(code).json({ error: msg });
  });

  app.use(router);
}

module.exports = { install };




