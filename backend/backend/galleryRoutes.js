// backend/galleryRoutes.js — Cloudinary (if configured) + disk fallback + comments/replies/reactions
const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");

// Pull users map so we can stamp name/avatar on comments
const { users } = require("./db");

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
// Force your backend base so front-end on Vercel can embed images freely
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

function withAbsoluteUrl(_req, item) {
  if (isAbs(item.url)) return item;
  const base = publicBase();
  return { ...item, url: `${base}${item.url}` };
}

// attach arrays & shapes on-demand
function normalizePhotoItem(it) {
  it.comments = Array.isArray(it.comments) ? it.comments : [];
  if (!it.reactions || typeof it.reactions !== "object") it.reactions = { up: [], down: [] };
  it.reactions.up = Array.isArray(it.reactions.up) ? it.reactions.up : [];
  it.reactions.down = Array.isArray(it.reactions.down) ? it.reactions.down : [];
  return it;
}

function findPhoto(store, userId, photoId) {
  const bucket = bucketFor(store, userId);
  const idx = bucket.items.findIndex((p) => String(p.id) === String(photoId));
  if (idx === -1) return { bucket, idx, item: null };
  const item = normalizePhotoItem(bucket.items[idx]);
  return { bucket, idx, item };
}

function currentActor(req) {
  const uid = (req.get("x-user-id") || "").trim();
  if (uid) return `u:${uid}`;
  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "0.0.0.0")
    .toString().split(",")[0].trim();
  return `anon:${ip}`;
}

function actorProfile(req) {
  const uid = (req.get("x-user-id") || "").trim();
  const safe = { id: currentActor(req), name: "", avatarUrl: "" };
  if (uid && users.has(uid)) {
    const u = users.get(uid);
    safe.name = u?.name || "";
    safe.avatarUrl = u?.avatarUrl || "";
  } else {
    safe.name = (req.get("x-user-name") || "").trim() || safe.id.replace(/^anon:/, "Guest ");
  }
  return safe;
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

    return res.json({ ok: true, count: added.length, items: added });
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

  /* ========== COMMENTS & REACTIONS (photos) ========== */

  // GET photo comments
  router.get("/api/users/:id/gallery/:photoId/comments", (req, res) => {
    const { id, photoId } = req.params;
    const store = readStore();
    const { item } = findPhoto(store, id, photoId);
    if (!item) return res.status(404).json({ error: "Photo not found" });
    const list = [...item.comments].sort((a, b) => Number(a.createdAt||0) - Number(b.createdAt||0));
    res.json(list);
  });

  // POST photo comment
  router.post("/api/users/:id/gallery/:photoId/comments", express.json(), (req, res) => {
    const { id, photoId } = req.params;
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "text required" });

    const store = readStore();
    const { item } = findPhoto(store, id, photoId);
    if (!item) return res.status(404).json({ error: "Photo not found" });

    const actor = actorProfile(req);
    const now = Date.now();
    const comment = {
      id: `c_${now}_${Math.random().toString(36).slice(2,7)}`,
      text, createdAt: now,
      user: { id: actor.id, name: actor.name, avatarUrl: actor.avatarUrl || "" },
      replies: [],
      reactions: { up: [], down: [] },
    };
    item.comments.push(comment);
    writeStore(store);
    res.status(201).json(comment);
  });

  // GET photo reactions (counts)
  router.get("/api/users/:id/gallery/:photoId/reactions", (req, res) => {
    const { id, photoId } = req.params;
    const store = readStore();
    const { item } = findPhoto(store, id, photoId);
    if (!item) return res.status(404).json({ error: "Photo not found" });
    const actor = currentActor(req);
    const up = item.reactions.up.length;
    const down = item.reactions.down.length;
    let action = "";
    if (item.reactions.up.includes(actor)) action = "up";
    if (item.reactions.down.includes(actor)) action = "down";
    res.json({ up, down, action });
  });

  // POST photo reaction toggle
  router.post("/api/users/:id/gallery/:photoId/reactions", express.json(), (req, res) => {
    const { id, photoId } = req.params;
    const wanted = String(req.body?.action || "").trim(); // "", "up", "down"
    if (!["", "up", "down"].includes(wanted)) return res.status(400).json({ error: 'action must be "", "up", or "down"' });

    const store = readStore();
    const { item } = findPhoto(store, id, photoId);
    if (!item) return res.status(404).json({ error: "Photo not found" });

    const actor = currentActor(req);
    item.reactions.up = item.reactions.up.filter((a) => a !== actor);
    item.reactions.down = item.reactions.down.filter((a) => a !== actor);
    if (wanted === "up") item.reactions.up.push(actor);
    if (wanted === "down") item.reactions.down.push(actor);

    writeStore(store);
    res.json({ ok: true, up: item.reactions.up.length, down: item.reactions.down.length, action: wanted });
  });

  /* ====== REPLIES & REACTIONS (comments) ====== */

  function findComment(store, ownerId, photoId, cid) {
    const { item } = findPhoto(store, ownerId, photoId);
    if (!item) return { photo: null, comment: null };
    const comment = (item.comments || []).find(c => String(c.id) === String(cid));
    if (!comment) return { photo: item, comment: null };
    // normalize
    comment.replies = Array.isArray(comment.replies) ? comment.replies : [];
    if (!comment.reactions || typeof comment.reactions !== "object") comment.reactions = { up: [], down: [] };
    comment.reactions.up = Array.isArray(comment.reactions.up) ? comment.reactions.up : [];
    comment.reactions.down = Array.isArray(comment.reactions.down) ? comment.reactions.down : [];
    return { photo: item, comment };
  }

  // GET replies
  router.get("/api/users/:id/gallery/:photoId/comments/:cid/replies", (req, res) => {
    const { id, photoId, cid } = req.params;
    const store = readStore();
    const { comment } = findComment(store, id, photoId, cid);
    if (!comment) return res.status(404).json({ error: "Comment not found" });
    const list = [...comment.replies].sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));
    res.json(list);
  });

  // POST reply
  router.post("/api/users/:id/gallery/:photoId/comments/:cid/replies", express.json(), (req, res) => {
    const { id, photoId, cid } = req.params;
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "text required" });

    const store = readStore();
    const { comment } = findComment(store, id, photoId, cid);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    const actor = actorProfile(req);
    const now = Date.now();
    const reply = {
      id: `r_${now}_${Math.random().toString(36).slice(2,7)}`,
      text, createdAt: now,
      user: { id: actor.id, name: actor.name, avatarUrl: actor.avatarUrl || "" },
      reactions: { up: [], down: [] },
    };
    comment.replies.push(reply);
    writeStore(store);
    res.status(201).json(reply);
  });

  // GET comment reactions
  router.get("/api/users/:id/gallery/:photoId/comments/:cid/reactions", (req, res) => {
    const { id, photoId, cid } = req.params;
    const store = readStore();
    const { comment } = findComment(store, id, photoId, cid);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    const actor = currentActor(req);
    const up = comment.reactions.up.length;
    const down = comment.reactions.down.length;
    let action = "";
    if (comment.reactions.up.includes(actor)) action = "up";
    if (comment.reactions.down.includes(actor)) action = "down";
    res.json({ up, down, action });
  });

  // POST comment reaction toggle
  router.post("/api/users/:id/gallery/:photoId/comments/:cid/reactions", express.json(), (req, res) => {
    const { id, photoId, cid } = req.params;
    const wanted = String(req.body?.action || "").trim();
    if (!["", "up", "down"].includes(wanted)) return res.status(400).json({ error: 'action must be "", "up", or "down"' });

    const store = readStore();
    const { comment } = findComment(store, id, photoId, cid);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    const actor = currentActor(req);
    comment.reactions.up = comment.reactions.up.filter(a => a !== actor);
    comment.reactions.down = comment.reactions.down.filter(a => a !== actor);
    if (wanted === "up") comment.reactions.up.push(actor);
    if (wanted === "down") comment.reactions.down.push(actor);

    writeStore(store);
    res.json({ ok: true, up: comment.reactions.up.length, down: comment.reactions.down.length, action: wanted });
  });

  /* ---------- DELETE photo ---------- */
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























