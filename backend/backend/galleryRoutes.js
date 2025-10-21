// backend/backend/galleryRoutes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

function install(app) {
  const router = express.Router();

  // ✅ use the same uploads dir the server already exposes at /uploads
  const uploadRoot =
    app.locals?.uploadsDir ||
    path.join(__dirname, "public", "uploads");
  fs.mkdirSync(uploadRoot, { recursive: true });

  // --- Multer setup
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
      if (/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.mimetype))
        cb(null, true);
      else cb(new Error("Only image files allowed"));
    },
  });

  // --- In-memory list (userId → [{id,url,createdAt}])
  const gallery = app.locals.galleryMap || (app.locals.galleryMap = new Map());
  const getUserId = (req) => (req.headers["x-user-id"] || "").toString().trim();

  /* ---------------------------------------------------
     1️⃣ GET /api/users/:id/gallery   → list user photos
  --------------------------------------------------- */
  router.get("/api/users/:id/gallery", (req, res) => {
    const uid = String(req.params.id || "");
    const list = gallery.get(uid) || [];
    res.json(list);
  });

  /* ---------------------------------------------------
     2️⃣ POST /api/account/gallery    → upload new photos
  --------------------------------------------------- */
  router.post("/api/account/gallery", upload.array("photos"), (req, res) => {
    const uid = getUserId(req);
    if (!uid)
      return res.status(401).json({ error: "Missing user id (x-user-id)" });
    if (!req.files?.length)
      return res.status(400).json({ error: "No files uploaded" });

    const curr = gallery.get(uid) || [];
    for (const f of req.files) {
      curr.push({
        id: f.filename,
        url: `/uploads/${f.filename}`,
        createdAt: Date.now(),
      });
    }
    gallery.set(uid, curr);
    res.json({ ok: true, items: curr.slice(-req.files.length) });
  });

  /* ---------------------------------------------------
     3️⃣ DELETE /api/users/:id/gallery/:photoId  → remove
  --------------------------------------------------- */
  router.delete("/api/users/:id/gallery/:photoId", (req, res) => {
    const { id: uid, photoId } = req.params;
    const curr = gallery.get(uid) || [];
    const next = curr.filter((p) => String(p.id) !== String(photoId));
    gallery.set(uid, next);
    try {
      fs.unlinkSync(path.join(uploadRoot, photoId));
    } catch {}
    res.json({ ok: true });
  });

  app.use(router);
}

module.exports = { install };





