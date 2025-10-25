// chatGlobal.js
const { randomUUID } = require("crypto");
const { users } = require("./db");
const express = require("express"); // ✅ for per-route JSON parsing

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
  // CORS preflight
  app.options("/api/chat/global", (req, res) => {
    const origin = req.headers.origin || "*";
    res.set({
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin",
    });
    res.sendStatus(204);
  });

  // History
  app.get("/api/chat/global", (req, res) => {
    const origin = req.headers.origin || "*";
    res.set({ "Access-Control-Allow-Origin": origin, "Vary": "Origin" });

    const since = String(req.query.since || "");
    let idx = 0;
    if (since) {
      idx = messages.findIndex((m) => m.id === since);
      idx = idx === -1 ? 0 : idx + 1;
    }
    res.json(messages.slice(idx).map(msgView));
  });

  // SSE stream
  app.get("/api/chat/global/stream", (req, res) => {
    const origin = req.headers.origin || "*";
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",      // ✅ prevent transforms/buffering
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": origin,
      "X-Accel-Buffering": "no",                      // ✅ Nginx/Render/CDN hint
      "Vary": "Origin",
    });
    res.flushHeaders();
    res.write("retry: 5000\n\n");

    const client = { res };
    clients.add(client);
    console.log(`🔌 SSE connect (total ${clients.size})`);

    const ping = setInterval(() => {
      try { res.write(`event: ping\ndata: {}\n\n`); } catch {}
    }, 25000);

    req.on("close", () => {
      clearInterval(ping);
      clients.delete(client);
      console.log(`❌ SSE disconnect (total ${clients.size})`);
    });
  });

  // Send (JSON body) — parse JSON *for this route only*
  app.post("/api/chat/global", express.json(), (req, res) => {  // ✅ per-route parser
    const origin = req.headers.origin || "*";
    res.set({ "Access-Control-Allow-Origin": origin, "Vary": "Origin" });

    const userId = String(req.body?.userId || "").trim();
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "Empty message" });

    const id = randomUUID();
    const createdAt = Date.now();
    const msg = { id, userId, text, createdAt };
    messages.push(msg);

    const payload = `data: ${JSON.stringify(msgView(msg))}\n\n`;
    for (const c of clients) {
      try { c.res.write(payload); } catch {}
    }

    res.status(201).json({ ok: true, id });
  });
}

module.exports = { install };





