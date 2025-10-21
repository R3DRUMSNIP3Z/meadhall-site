const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

function install(app) {
  const router = express.Router();

  // ✅ use same /uploads folder as avatars and contests
  const uploadRoot =
    app.locals?.uploadsDir || path.join(__dirname, "public", "uploads");
  fs.mkdirSync(uploadRoot, { recursive: true });

  // 📘 gallery.json persistence file
  const dataDir = path.join(__dirname, "data");
  const galleryFile = path.join(dataDir, "gallery.json");
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(galleryFile)) fs.writeFileSync(galleryFile, "{}");

  const loadGalleryFromDisk = () => {
    try {
      return JSON.parse(fs.readFileSync(galleryFile, "utf8"));
    } catch {
      return {};
    }
  };
  const saveGalleryToDisk = (data) =>
    fs.writeFileSync(galleryFile, JSON.stringify(data, null, 2));

  // Load initial memory cache
  const gallery = app.locals.galleryMap || (app.locals.galleryMap = new Map());
  const json = loadGalleryFromDisk();
  for (const [uid, list] of Object.entries(json)) gallery.set(uid, list);

  const getUserId = (req) => (req.headers["x-user-id"] || "").toString().trim();

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
      if (/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.mimetype)) cb(null, true);
      else cb(new Error("Only image files allowed"));
    },
  });

  /* ---------------------------------------------------
     GET /api/users/:id/gallery   → list user's photos
  --------------------------------------------------- */
  router.get("/api/users/:id/gallery", (req, res) => {
    const uid = String(req.params.id || "");
    const list = gallery.get(uid) || [];
    res.json(list);
  });

  /* ---------------------------------------------------
     POST /api/account/gallery   → upload new photos
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

    // 💾 persist to disk
    const data = Object.fromEntries(gallery);
    saveGalleryToDisk(data);

    res.json({ ok: true, items: curr.slice(-req.files.length) });
  });

  /* ---------------------------------------------------
     DELETE /api/users/:id/gallery/:photoId
  --------------------------------------------------- */
  router.delete("/api/users/:id/gallery/:photoId", (req, res) => {
    const { id: uid, photoId } = req.params;
    const curr = gallery.get(uid) || [];
    const next = curr.filter((p) => String(p.id) !== String(photoId));
    gallery.set(uid, next);
    try { fs.unlinkSync(path.join(uploadRoot, photoId)); } catch {}
    saveGalleryToDisk(Object.fromEntries(gallery));
    res.json({ ok: true });
  });

  app.use(router);
}

module.exports = { install };






