// backend/gameRoutes.js
const express = require("express");
const { users } = require("./db"); // your in-memory users map

// In-memory game state
// state[userId] = { name, level, xp, gold, power, defense, speed, points, lastTick }
const state = Object.create(null);

// Simple shop
const SHOP = [
  { id: "wpn1", name: "Rusty Sword", stat: "power",   boost: 2,  cost: 50 },
  { id: "arm1", name: "Leather Vest", stat: "defense", boost: 2,  cost: 50 },
  { id: "boo1", name: "Light Boots",  stat: "speed",   boost: 2,  cost: 50 },
  { id: "rel1", name: "Minor Relic",  stat: "power",   boost: 5,  cost: 150 },
];

function ensure(uId) {
  if (!state[uId]) {
    const u = users.get(uId) || { id: uId, name: "Unknown" };
    state[uId] = {
      id: u.id,
      name: u.name || "Skald",
      level: 1, xp: 0, gold: 100,
      power: 5, defense: 5, speed: 5,
      points: 0,
      lastTick: Date.now()
    };
  }
  return state[uId];
}

function tick(me) {
  const now = Date.now();
  const dt = Math.max(0, Math.floor((now - (me.lastTick || now)) / 1000)); // seconds
  if (dt <= 0) return me;
  // passive: +1 gold per sec, +1 xp per 5 sec
  me.gold += dt * 1;
  const xpGain = Math.floor(dt / 5);
  me.xp += xpGain;

  // level up
  const need = me.level * 100;
  while (me.xp >= need) {
    me.xp -= need;
    me.level += 1;
    me.points += 3; // grant points on level-up (kept simple)
  }
  me.lastTick = now;
  return me;
}

function fightCalc(m) {
  // Basic Battle Rating with a little randomness
  const roll = () => (Math.random() * 10) - 5; // [-5, +5)
  return m.power * 1.0 + m.defense * 0.8 + m.speed * 0.6 + roll();
}

function pickRandomOpponent(myId) {
  const ids = Object.keys(state).filter(id => id !== myId);
  if (!ids.length) return null;
  const id = ids[Math.floor(Math.random() * ids.length)];
  return state[id];
}

function install(app) {
  const router = express.Router();

  // Auth shim: read x-user-id (your CORS allows this header already)
  router.use((req, res, next) => {
    const uId = req.get("x-user-id");
    if (!uId) return res.status(401).json({ error: "Missing x-user-id" });
    req.userId = uId;
    next();
  });

  router.get("/game/me", (req, res) => {
    const me = tick(ensure(req.userId));
    res.json({ me });
  });

  router.post("/game/tick", express.json(), (req, res) => {
    const me = tick(ensure(req.userId));
    res.json({ me });
  });

  router.post("/game/train", express.json(), (req, res) => {
    const me = tick(ensure(req.userId));
    const { stat } = req.body || {};
    if (!["power", "defense", "speed"].includes(stat))
      return res.status(400).json({ error: "Invalid stat" });

    // 3s client cooldown; server side: charge a tiny gold cost to curb spam
    if (me.gold < 2) return res.status(400).json({ error: "Not enough gold" });
    me.gold -= 2;
    me[stat] += 1;
    me.xp += 2;
    res.json({ me });
  });

  router.get("/game/shop", (req, res) => {
    res.json({ items: SHOP });
  });

  router.post("/game/shop/buy", express.json(), (req, res) => {
    const me = tick(ensure(req.userId));
    const { itemId } = req.body || {};
    const item = SHOP.find(i => i.id === itemId);
    if (!item) return res.status(404).json({ error: "No such item" });
    if (me.gold < item.cost) return res.status(400).json({ error: "Not enough gold" });

    me.gold -= item.cost;
    me[item.stat] += item.boost;
    res.json({ me, item });
  });

  // --- PvP ---
  router.post("/pvp/fight", express.json(), (req, res) => {
    const me = tick(ensure(req.userId));
    const mode = (req.body && req.body.mode) || "random";

    let opp = null;
    if (mode === "random") {
      opp = pickRandomOpponent(req.userId);
      if (!opp) return res.status(400).json({ error: "No opponents yet. Get a friend to play!" });
      tick(opp); // keep them fresh, too
    } else {
      return res.status(400).json({ error: "Unsupported mode" });
    }

    const myBR = fightCalc(me);
    const opBR = fightCalc(opp);
    const win = myBR >= opBR;

    const deltaGold = win ? 25 : -10;
    const deltaXP   = win ? 50 : 15;

    me.gold = Math.max(0, me.gold + deltaGold);
    me.xp += deltaXP;

    // level checks
    const need = me.level * 100;
    while (me.xp >= need) { me.xp -= need; me.level += 1; me.points += 3; }

    res.json({
      me,
      result: {
        win,
        opponent: { id: opp.id, name: opp.name, level: opp.level },
        deltaGold,
        deltaXP
      }
    });
  });

  app.use("/api", router);
}

module.exports = { install };
