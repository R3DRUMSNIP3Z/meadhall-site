// backend/chatGlobal.js
const express = require("express");
const { randomUUID } = require("crypto");
const { users } = require("./db");

const messages = [];
const clients = new Set();

function msgView(m) {
  const u = users.get(m.userId) || {};
  return {
    id: m.id,
    text: m.text,
    createdAt: m.createdAt,
    user: {
      id: u.id || null,
      name: u.name || "skald",
      avatarUrl: u.avatarUrl || null,
    },
  };
}

function install(app) {
  // --- History ---
  app.get("/api/chat/global", (req, res) => {
    const since = req.query.since || "";
    const startIdx = since ? messages.findIndex(m => m.id === since) + 1 : 0;
    const slice = messages.slice(startIdx).map(msgView);
    res.json(slice);
  });

  // --- Live stream (SSE) ---
  app.get("/api/chat/global/stream", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.flushHeaders();

    clients.add(res);
    res.write(`data: ${JSON.stringify({ sys: "connected" })}\n\n`);

    req.on("close", () => clients.delete(res));
  });

  // --- Send message ---
  app.post("/api/chat/global", express.json(), (req, res) => {
    const { userId, text } = req.body || {};
    if (!text || typeof text !== "string")
      return res.status(400).json({ error: "invalid text" });

    const msg = { id: randomUUID(), userId, text, createdAt: Date.now() };
    messages.push(msg);

    // broadcast
    const payload = `data: ${JSON.stringify(msgView(msg))}\n\n`;
    for (const c of clients) c.write(payload);

    res.json({ ok: true, id: msg.id });
  });

  console.log("✅ chatGlobal routes mounted");
}

module.exports = { install };
