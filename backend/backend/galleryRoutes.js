// backend/backend/galleryRoutes.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

// ---------- storage ----------
const uploadRoot = path.join(process.cwd(), "public", "uploads");
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadRoot),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/\s+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage });

// ---------- in-memory gallery (userId -> photos[]) ----------
/** @type {Map<string, Array<{id:string,url:string,createdAt:number}>>} */
const gallery = new Map();

// helper
function getUserId(req) {
  // Same header your frontend already sends
  return (req.headers["x-user-id"] || "").toString().trim();
}

// ---------- routes ----------

// GET: list a user's photos
router.get("/api/users/:id/gallery", (req, res) => {
  const uid = String(req.params.id);
  const list = gallery.get(uid) || [];
  // Return plain array; your frontend accepts array or {items:[]}
  res.json(list);
});

// POST: upload photos for current user (field: "photos")
router.post("/api/account/gallery", upload.array("photos"), (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ error: "Missing user id (x-user-id header)" });
  if (!req.files?.length) return res.status(400).json({ error: "No files uploaded" });

  const curr = gallery.get(uid) || [];
  for (const f of req.files) {
    curr.push({
      id: f.filename,
      // return RELATIVE url so frontend fullUrl() can prefix with API_BASE
      url: `/uploads/${f.filename}`,
      createdAt: Date.now(),
    });
  }
  gallery.set(uid, curr);
  res.json({ ok: true, items: curr });
});

// DELETE: remove one photo
router.delete("/api/users/:id/gallery/:photoId", (req, res) => {
  const { id: uid, photoId } = req.params;
  const list = gallery.get(uid) || [];
  const next = list.filter((p) => p.id !== photoId);
  gallery.set(uid, next);

  // best-effort file delete
  try { fs.unlinkSync(path.join(uploadRoot, photoId)); } catch {}

  res.json({ ok: true });
});

export default router;

