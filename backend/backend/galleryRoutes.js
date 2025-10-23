// backend/galleryRoutes.js — Cloudinary (if configured) + disk fallback + comments/reactions
const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");

// ---------- detect Cloudinary ----------
const HAVE_CLOUDY =
  !!process.env.CLOUDINARY_CLOUD_NAME &&
  !!process.env.CLOUDINARY_API_KEY &&
  !!process.env.CLOUDINARY_API_SECRET;

let cloudinary = null;
let CloudinaryStorage = null;
if (HAVE_CLOUDY) {
  try {
    cloudinary = require("cloudinary").v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    CloudinaryStorage = require("multer-storage-cloudinary").CloudinaryStorage;
    console.log("📷 Gallery storage: Cloudinary");
  } catch (e) {
    console.warn("Cloudinary init failed; falling back to disk:", e.message);
  }
} else {
  console.log("📷 Gallery storage: Local disk (no Cloudinary env)");
}

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
// ✅ Force Render backend domain so Vercel never steals the origin
function publicBase(_req) {
  const hardBase = process.env.SERVER_PUBLIC_URL || "https://meadhall-site.onrender.com";
  return hardBase.replace(/\/+$/, "");
}

const isAbs = (u) => /^https?:\/\//i.test(u);
const isCloudUrl = (u = "") => /res\.cloudinary\.com/i.test(u);

const getUid = (req) => {
  const h = (req.headers["x-user-id"] || "").toString().trim();
  if (h) return h;
  if (req.params?.id) return String(req.params.id).trim();
  if (req.query?.user) return String(req.query.user).trim();
  if (req.body?.userId) return String(req.body.userId).trim();
  return "";
};

function withAbsoluteUrl(req, item) {
  if (isAbs(item.url)) return item;
  const base = publicBase(req);
  return { ...item, url: `${base}${item.url}` };
}

/* ---------- installer ---------- */
function install(app) {
  const router = express.Router();

  // Share the same /uploads folder as index.js
  const uploadRoot = app.locals?.uploadsDir || path.join(__dirname, "public", "uploads");
  fs.mkdirSync(uploadRoot, { recursive: true });

  // ---------- Build storage (Cloudinary or Disk) ----------
  let galleryMulter = null;

  if (HAVE_CLOUDY && cloudinary && CloudinaryStorage) {
    const storage = new CloudinaryStorage({
      cloudinary,
      params: (req, file) => {
        const uid = getUid(req) || "anonymous";
        return {
          folder: `meadhall/gallery/${uid}`,
          resource_type: "image",
          allowed_formats: ["png", "jpg", "jpeg", "webp", "gif", "avif"],
          use_filename: false,
          unique_filename: true,
          overwrite: false,
        };
      },
    });

    galleryMulter = multer({
      storage,
      limits: { fileSize: 12 * 1024 * 1024 },
      fileFilter: (_req, file, cb) =>
        /^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.mimetype)
          ? cb(null, true)
          : cb(new Error("Only image files are allowed")),
    });
  } else {
    // Disk fallback
    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadRoot),
      filename: (_req, file, cb) => {
        const safe = String(file.originalname || "photo").replace(/\s+/g, "_");
        cb(null, `${Date.now()}-${safe}`);
      },
    });

    galleryMulter = multer({
      storage,
      limits: { fileSize: 12 * 1024 * 1024 },
      fileFilter: (_req, file, cb) =>
        /^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.mimetype)
          ? cb(null, true)
          : cb(new Error("Only image files are allowed")),
    });
  }

  const acceptMany = (field) => (req, res, next) =>
    galleryMulter.array(field, 20)(req, res, (err) =>
      (err && err.message !== "Unexpected field") ? next(err) : next()
    );

  /* ---------- READ ---------- */
  router.get("/api/users/:id/gallery", (req, res) => {
    const userId = String(req.params.id || "");
    const store = readStore();
    const { items } = bucketFor(store, userId);
    return res.json(items.map((it) => withAbsoluteUrl(req, it)));
  });

  router.get("/api/gallery", (req, res) => {
    const userId = String(req.query.user || "");
    if (!userId) return res.status(400).json({ error: "user is required" });
    const store = readStore();
    const { items } = bucketFor(store, userId);
    return res.json({ items: items.map((it) => withAbsoluteUrl(req, it)) });
  });

  router.get("/api/account/gallery", (req, res) => {
    const uid = getUid(req);
    if (!uid) return res.status(400).json({ ok: false, error: "Use POST with x-user-id and files" });
    return res.json({ ok: true, hint: "POST 'photos' | 'photo[]' | 'photo' + header x-user-id" });
  });

  /* ---------- CREATE (UPLOAD) ---------- */
  async function handleUpload(req, res) {
    const userId = getUid(req);
    if (!userId) return res.status(401).json({ error: "Missing user id" });

    if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

    const store = readStore();
    const bucket = bucketFor(store, userId);
    const added = [];

    for (const f of req.files) {
      try {
        if (HAVE_CLOUDY && f?.path && /^https?:\/\//.test(String(f.path))) {
          const publicId = String(f.filename || f.public_id || "").trim();
          const url = String(f.path || f.secure_url || f.url || "").trim();
          const item = { id: publicId, publicId, url, createdAt: Date.now() };
          bucket.items.push(item);
          added.push(withAbsoluteUrl(req, item));
        } else {
          const filename = path.basename(f.path || f.filename || "");
          const item = { id: filename, url: `/uploads/${filename}`, createdAt: Date.now() };
          bucket.items.push(item);
          added.push(withAbsoluteUrl(req, item));
        }
      } catch (e) {
        console.error("[gallery] per-file error:", e && e.message);
      }
    }

    writeStore(store);

    if (!added.length) {
      return res.status(500).json({
        error: HAVE_CLOUDY
          ? "Upload failed (Cloudinary error). Check credentials/plan/network."
          : "Upload failed (disk).",
      });
    }

    return res.json({
      ok: true,
      count: added.length,
      items: added.map((it) => withAbsoluteUrl(req, it)),
    });
  }

  router.post(
    "/api/account/gallery",
    acceptMany("photos"),
    (req, res, next) => (req.files?.length ? next() : acceptMany("photo[]")(req, res, next)),
    (req, res, next) => (req.files?.length ? next() : galleryMulter.array("photo", 20)(req, res, next)),
    (req, res, next) => { handleUpload(req, res).catch((e) => next(e)); }
  );

  router.post(
    "/api/users/:id/gallery",
    acceptMany("photos"),
    (req, res, next) => (req.files?.length ? next() : acceptMany("photo[]")(req, res, next)),
    (req, res, next) => (req.files?.length ? next() : galleryMulter.array("photo", 20)(req, res, next)),
    (req, res, next) => { handleUpload(req, res).catch((e) => next(e)); }
  );

  /* ========== COMMENTS & REACTIONS (NEW) ========== */

  // Locate a photo within store and ensure sub-structures exist
  function findPhoto(store, userId, photoId) {
    const bucket = bucketFor(store, userId);
    const idx = bucket.items.findIndex((p) => String(p.id) === String(photoId));
    if (idx === -1) return { bucket, idx, item: null };
    const item = bucket.items[idx];

    // normalize shape
    item.comments = Array.isArray(item.comments) ? item.comments : [];
    item.reactions = item.reactions && typeof item.reactions === "object" ? item.reactions : { up: [], down: [] };
    item.reactions.up = Array.isArray(item.reactions.up) ? item.reactions.up : [];
    item.reactions.down = Array.isArray(item.reactions.down) ? item.reactions.down : [];

    return { bucket, idx, item };
  }

  // Who is acting? Prefer signed-in user; else anonymous IP "bucket"
  function currentActor(req) {
    const uid = (req.get("x-user-id") || "").trim();
    if (uid) return `u:${uid}`;
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "0.0.0.0")
      .toString().split(",")[0].trim();
    return `anon:${ip}`;
  }

  // ---- COMMENTS ----
  // GET list
  router.get("/api/users/:id/gallery/:photoId/comments", (req, res) => {
    const userId = String(req.params.id || "");
    const photoId = String(req.params.photoId || "");
    const store = readStore();
    const { item } = findPhoto(store, userId, photoId);
    if (!item) return res.status(404).json({ error: "Photo not found" });
    const list = [...item.comments].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return res.json(list);
  });

  // POST add
  router.post("/api/users/:id/gallery/:photoId/comments", express.json(), (req, res) => {
    const userId = String(req.params.id || "");
    const photoId = String(req.params.photoId || "");
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "text required" });

    const store = readStore();
    const { item } = findPhoto(store, userId, photoId);
    if (!item) return res.status(404).json({ error: "Photo not found" });

    const actor = currentActor(req);
    const nameFromHeader = (req.get("x-user-name") || "").trim();
    const comment = {
      id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text,
      createdAt: Date.now(),
      user: { id: actor, name: nameFromHeader || actor.replace(/^anon:/, "Guest ") },
    };
    item.comments.push(comment);
    writeStore(store);
    return res.status(201).json(comment);
  });

  // ---- REACTIONS ----
  // GET counts + caller's action
  router.get("/api/users/:id/gallery/:photoId/reactions", (req, res) => {
    const userId = String(req.params.id || "");
    const photoId = String(req.params.photoId || "");
    const store = readStore();
    const { item } = findPhoto(store, userId, photoId);
    if (!item) return res.status(404).json({ error: "Photo not found" });

    const actor = currentActor(req);
    const up = item.reactions.up.length;
    const down = item.reactions.down.length;
    let action = "";
    if (item.reactions.up.includes(actor)) action = "up";
    else if (item.reactions.down.includes(actor)) action = "down";
    return res.json({ up, down, action });
  });

  // POST toggle reaction: { action: "" | "up" | "down" }
  router.post("/api/users/:id/gallery/:photoId/reactions", express.json(), (req, res) => {
    const userId = String(req.params.id || "");
    const photoId = String(req.params.photoId || "");
    const wanted = String(req.body?.action || "").trim(); // "", "up", "down"
    if (!["", "up", "down"].includes(wanted)) {
      return res.status(400).json({ error: 'action must be "", "up", or "down"' });
    }

    const store = readStore();
    const { item } = findPhoto(store, userId, photoId);
    if (!item) return res.status(404).json({ error: "Photo not found" });

    const actor = currentActor(req);
    // remove existing votes by this actor
    item.reactions.up = item.reactions.up.filter((a) => a !== actor);
    item.reactions.down = item.reactions.down.filter((a) => a !== actor);
    // apply new one
    if (wanted === "up") item.reactions.up.push(actor);
    if (wanted === "down") item.reactions.down.push(actor);

    writeStore(store);
    return res.json({
      ok: true,
      up: item.reactions.up.length,
      down: item.reactions.down.length,
      action: wanted,
    });
  });

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

    try {
      if (HAVE_CLOUDY && (removed?.publicId || isCloudUrl(removed?.url))) {
        const pid = removed.publicId || removed.id;
        await cloudinary.uploader.destroy(pid, { resource_type: "image" });
      } else if (removed?.url && !isAbs(removed.url)) {
        const fileName = removed?.id || path.basename(removed.url);
        await fs.promises.unlink(path.join(uploadRoot, fileName)).catch(() => {});
      }
    } catch (e) {
      console.warn("[gallery] delete warning:", e && e.message);
    }

    return res.status(204).end();
  });

  /* ---------- error → readable JSON ---------- */
  router.use((err, _req, res, _next) => {
    const msg = err?.message || String(err);
    console.error("[gallery] error:", msg);
    const code = /file|multer|cloudinary/i.test(msg) ? 400 : 500;
    const pretty =
      /File too large/i.test(msg) ? "Image exceeds 12MB limit" :
      /Only image files/i.test(msg) ? "Only image files are allowed" :
      msg;
    return res.status(code).json({ error: pretty });
  });

  app.use(router);
}

module.exports = { install };






















