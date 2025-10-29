// backend/notifications.js
const express = require("express");
const router = express.Router();

// ---- In-memory store (swap for DB later) ----
/*
 Notification shape:
 {
   id: string,
   type: "friend" | "like" | "dislike" | "comment" | "visit",
   targetUserId: string,       // who should see it
   actor: { id, name, avatarUrl? },
   meta: {                     // extra bits to render
     text?: string,            // short message
     objectId?: string,        // photoId, commentId, etc
     objectType?: "photo" | "comment" | "profile",
     link?: string             // where to go when clicked
   },
   read: boolean,
   createdAt: number
 }
*/
const notifications = [];
const listeners = new Map(); // userId -> Set(res)

// util
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function unreadCountFor(userId) {
  return notifications.filter(n => n.targetUserId === userId && !n.read).length;
}

function fanout(userId, payloadObj) {
  const set = listeners.get(userId);
  if (!set) return;
  const payload = `data: ${JSON.stringify(payloadObj)}\n\n`;
  for (const res of set) res.write(payload);
}

function pushAndFanout(n) {
  notifications.unshift(n);
  // notify SSE listeners for this user
  fanout(n.targetUserId, { event: "notification", data: n });
  // also send updated unread count to keep badges in sync across tabs
  fanout(n.targetUserId, { event: "unread", data: { unread: unreadCountFor(n.targetUserId) } });
  return n;
}

// ---- public helpers (import from other routes) ----
function createNotification({ type, targetUserId, actor, meta }) {
  if (!type || !targetUserId || !actor?.id) return null;
  const n = {
    id: uid(),
    type,
    targetUserId,
    actor: { id: actor.id, name: actor.name, avatarUrl: actor.avatarUrl },
    meta: meta || {},
    read: false,
    createdAt: Date.now()
  };
  return pushAndFanout(n);
}

// ---- REST API ----

// list notifications (latest first)
router.get("/", (req, res) => {
  const userId = (req.query.userId || "").trim();
  if (!userId) return res.status(400).json({ error: "userId required" });
  const items = notifications
    .filter(n => n.targetUserId === userId)
    .slice(0, 100);
  res.json({ items });
});

// shared handler to mark read by ids or all
async function handleMarkRead(body, res) {
  const { userId, ids } = body || {};
  if (!userId) return res.status(400).json({ error: "userId required" });

  let updated = 0;
  for (const n of notifications) {
    if (n.targetUserId !== userId) continue;
    if (Array.isArray(ids) && ids.length) {
      if (ids.includes(n.id) && !n.read) { n.read = true; updated++; }
    } else {
      if (!n.read) { n.read = true; updated++; }
    }
  }

  // push unread update to any open SSE clients for this user
  fanout(userId, { event: "unread", data: { unread: unreadCountFor(userId) } });
  return res.json({ ok: true, updated });
}

// mark read (PATCH – existing)
router.patch("/read", express.json(), (req, res) => {
  handleMarkRead(req.body, res);
});

// mark read (POST – for clients that send POST)
router.post("/read", express.json(), (req, res) => {
  handleMarkRead(req.body, res);
});

// alias: /mark-read (POST)
router.post("/mark-read", express.json(), (req, res) => {
  handleMarkRead(req.body, res);
});

// SSE stream
router.get("/stream", (req, res) => {
  const userId = (req.query.userId || "").trim();
  if (!userId) return res.status(400).end();

  req.socket.setTimeout(0);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Register listener
  let set = listeners.get(userId);
  if (!set) { set = new Set(); listeners.set(userId, set); }
  set.add(res);

  // send hello + unread count
  res.write(`data: ${JSON.stringify({ event: "hello", data: { unread: unreadCountFor(userId) } })}\n\n`);

  req.on("close", () => {
    set.delete(res);
    if (set.size === 0) listeners.delete(userId);
  });
});

// optional: delete (admin/dev)
router.delete("/", express.json(), (req, res) => {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId required" });
  let i = notifications.length;
  while (i--) if (notifications[i].targetUserId === userId) notifications.splice(i, 1);
  // also notify clients count is zero now
  fanout(userId, { event: "unread", data: { unread: 0 } });
  res.json({ ok: true });
});

// install helper
function install(app) {
  app.use("/api/notifications", router);
  // provide app.locals.notify so other routes can emit
  app.locals.notify = createNotification;
}

module.exports = { install, createNotification };


