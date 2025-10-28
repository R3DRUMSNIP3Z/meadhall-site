// backend/notifications.js
const express = require("express");
const { randomUUID } = require("crypto");
const { users } = require("./db"); // we’ll use this to stamp names/avatars

// In-memory store (swap to DB later)
const notesByUser = new Map();   // userId -> [{...notification}]
const clientsByUser = new Map(); // userId -> Set(res SSE)

function pushNote(userId, note) {
  const list = notesByUser.get(userId) || [];
  list.unshift(note); // newest first
  notesByUser.set(userId, list);

  // fan-out via SSE
  const clients = clientsByUser.get(userId);
  if (clients) {
    const payload = `data: ${JSON.stringify(note)}\n\n`;
    for (const res of clients) { try { res.write(payload); } catch {} }
  }
}

function decorate(n) {
  const from = users.get(n.fromUserId) || {};
  return {
    ...n,
    from: {
      id: from.id || null,
      name: from.name || "skald",
      avatarUrl: from.avatarUrl || null,
    },
  };
}

function install(app) {
  const router = express.Router();

  // List notifications
  router.get("/users/:uid/notifications", (req, res) => {
    const { uid } = req.params;
    const { unread, limit = 50 } = req.query;
    let list = (notesByUser.get(uid) || []).map(decorate);
    if (String(unread) === "1") list = list.filter(n => !n.read);
    list = list.slice(0, Math.min(200, Number(limit) || 50));
    res.json(list);
  });

  // Mark read
  router.post("/users/:uid/notifications/mark-read", express.json(), (req, res) => {
    const { uid } = req.params;
    const { ids } = req.body || {};
    const list = notesByUser.get(uid) || [];
    const set = new Set(Array.isArray(ids) ? ids : []);
    for (const n of list) if (set.has(n.id)) n.read = true;
    res.json({ ok: true });
  });

  // SSE stream
  router.get("/users/:uid/notifications/stream", (req, res) => {
    const { uid } = req.params;
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.flushHeaders();

    let set = clientsByUser.get(uid);
    if (!set) clientsByUser.set(uid, (set = new Set()));
    set.add(res);
    req.on("close", () => set.delete(res));

    // kick with count
    const unread = (notesByUser.get(uid) || []).filter(n => !n.read).length;
    res.write(`data: ${JSON.stringify({ type:"hello", unread })}\n\n`);
  });

  // Demo creator (optional) — hit this to seed a notification
  router.post("/notify", express.json(), (req, res) => {
    const { userId, fromUserId, type, text, link } = req.body || {};
    if (!userId || !type) return res.status(400).json({ error: "userId & type required" });
    const note = {
      id: randomUUID(),
      userId,
      fromUserId: fromUserId || null,
      type,                 // 'comment' | 'like' | 'friend_request'
      text: text || "",
      link: link || null,   // e.g. "/friendprofile.html?user=..."
      createdAt: Date.now(),
      read: false,
    };
    pushNote(userId, note);
    res.json({ ok: true, id: note.id });
  });

  app.use("/api", router);
  console.log("✅ notifications routes mounted");
}

module.exports = { install, pushNote };
