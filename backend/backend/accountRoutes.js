// backend/accountRoutes.js
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { users, stories } = require("./db"); // stories: Map<userId, Story[]>

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer storage for avatars (safe filenames)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || "upload").replace(/\s+/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage });

// Strip password etc.
function safeUser(u) {
  if (!u) return null;
  const { id, name, email, avatarUrl, bio, interests, createdAt } = u;
  return { id, name, email, avatarUrl, bio, interests, createdAt };
}

// Helper: find a story by id within a user's list; returns { list, idx }
function findStoryForUser(userId, sid) {
  const list = stories.get(userId) || [];
  const idx = list.findIndex((s) => String(s.id) === String(sid));
  return { list, idx };
}

// Helper: find a story globally (for /api/stories/:sid aliases)
function findStoryGlobal(sid) {
  for (const [uid, list] of stories.entries()) {
    const idx = list.findIndex((s) => String(s.id) === String(sid));
    if (idx !== -1) return { userId: uid, list, idx };
  }
  return { userId: null, list: null, idx: -1 };
}

function install(app) {
  // NOTE: Static serving of /uploads should already be in index.js:
  // app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  // ðŸ”Ž Search users by name/email/id â€” MUST be before "/api/users/:id"
  app.get("/api/users/search", (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    if (!q) return res.json([]);

    const results = [...users.values()]
      .filter((u) =>
        String(u.id).toLowerCase() === q ||
        String(u.name || "").toLowerCase().includes(q) ||
        String(u.email || "").toLowerCase().includes(q)
      )
      .map(safeUser);

    res.json(results); // [] if none
  });

  // Get public/safe user by ID
  app.get("/api/users/:id", (req, res) => {
    const u = users.get(req.params.id);
    if (!u) return res.status(404).json({ error: "User not found" });
    // Backfill createdAt for old records
    if (!u.createdAt) { u.createdAt = Date.now(); users.set(u.id, u); }
    res.json(safeUser(u));
  });

  // Update profile fields (JSON body already parsed globally in index.js)
  app.put("/api/users/:id", (req, res) => {
    const u = users.get(req.params.id);
    if (!u) return res.status(404).json({ error: "User not found" });

    const { name, bio, interests } = req.body || {};
    if (typeof name === "string") u.name = name;
    if (typeof bio === "string") u.bio = bio;
    if (typeof interests === "string") u.interests = interests;

    users.set(u.id, u);
    res.json(safeUser(u));
  });

  // Upload avatar â€” return a FULL URL so frontend doesn't need to prefix
  app.post("/api/users/:id/avatar", upload.single("file"), (req, res) => {
    const u = users.get(req.params.id);
    if (!u) return res.status(404).json({ error: "User not found" });
    if (!req.file) return res.status(400).json({ error: "No file" });

    const base = `${req.protocol}://${req.get("host")}`;
    u.avatarUrl = `${base}/uploads/${req.file.filename}`;
    users.set(u.id, u);
    res.json(safeUser(u));
  });

  // ===== STORIES =====

  // List stories for a user
  app.get("/api/users/:id/stories", (req, res) => {
    res.json(stories.get(req.params.id) || []);
  });

  // Add story for a user
  app.post("/api/users/:id/stories", (req, res) => {
    const u = users.get(req.params.id);
    if (!u) return res.status(404).json({ error: "User not found" });

    const { title, text } = req.body || {};
    if (!title || !text) return res.status(400).json({ error: "Missing fields" });

    const now = Date.now();
    const entry = { id: String(now), title: String(title), text: String(text), createdAt: now, updatedAt: now };
    const list = stories.get(u.id) || [];
    list.unshift(entry); // newest first
    stories.set(u.id, list);

    res.status(201).json(entry);
  });

  // UPDATE a story (primary route)
  app.put("/api/users/:id/stories/:sid", (req, res) => {
    const uid = String(req.params.id);
    const sid = String(req.params.sid);
    const { list, idx } = findStoryForUser(uid, sid);
    if (idx === -1) return res.status(404).json({ error: "Story not found" });

    const { title, text } = req.body || {};
    if (typeof title === "string") list[idx].title = title;
    if (typeof text === "string") list[idx].text = text;
    list[idx].updatedAt = Date.now();
    stories.set(uid, list);

    res.json(list[idx]);
  });

  // DELETE a story (primary route)
  app.delete("/api/users/:id/stories/:sid", (req, res) => {
    const uid = String(req.params.id);
    const sid = String(req.params.sid);
    const { list, idx } = findStoryForUser(uid, sid);
    if (idx === -1) return res.status(404).json({ error: "Story not found" });

    list.splice(idx, 1);
    stories.set(uid, list);
    res.status(204).end();
  });

  // --- OPTIONAL ALIASES to support clients that call /api/stories/:sid ---

  // Update by story id only (global search)
  app.put("/api/stories/:sid", (req, res) => {
    const sid = String(req.params.sid);
    const { userId, list, idx } = findStoryGlobal(sid);
    if (idx === -1) return res.status(404).json({ error: "Story not found" });

    const { title, text } = req.body || {};
    if (typeof title === "string") list[idx].title = title;
    if (typeof text === "string") list[idx].text = text;
    list[idx].updatedAt = Date.now();
    stories.set(userId, list);

    res.json(list[idx]);
  });

  // Delete by story id only (global search)
  app.delete("/api/stories/:sid", (req, res) => {
    const sid = String(req.params.sid);
    const { userId, list, idx } = findStoryGlobal(sid);
    if (idx === -1) return res.status(404).json({ error: "Story not found" });

    list.splice(idx, 1);
    stories.set(userId, list);
    res.status(204).end();
  });
}

module.exports = { install };











