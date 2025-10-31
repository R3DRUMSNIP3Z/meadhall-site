// backend/gameRoutes.js
const express = require("express");
const { users } = require("./db");

// -------- In-memory game state --------
// state[userId] = { id, name, level, xp, gold, power, defense, speed, points, gender, slots, gearPower, lastTick }
const state = Object.create(null);

// -------- Shop (includes gear w/ slot + level req) --------
const SHOP = [
  { id: "wpn1", name: "Rusty Sword",   stat: "power",   boost: 2,  cost: 50 },
  { id: "arm1", name: "Leather Vest",  stat: "defense", boost: 2,  cost: 50 },
  { id: "boo1", name: "Light Boots",   stat: "speed",   boost: 2,  cost: 50 },

  { id: "helm1", name: "Bronze Helm",      stat: "power", boost: 5,  cost: 120, slot: "helm",      levelReq: 5  },
  { id: "sho1",  name: "Wolf Shoulders",   stat: "power", boost: 6,  cost: 150, slot: "shoulders", levelReq: 8  },
  { id: "ch1",   name: "Chainmail",        stat: "defense",boost: 8,  cost: 180, slot: "chest",     levelReq: 10 },
  { id: "gl1",   name: "Hunter Gloves",    stat: "power", boost: 4,  cost: 120, slot: "gloves",    levelReq: 12 },
  { id: "bt1",   name: "Ranger Boots",     stat: "speed", boost: 4,  cost: 120, slot: "boots",     levelReq: 15 },
  { id: "ring1", name: "Runic Ring",       stat: "power", boost: 7,  cost: 160, slot: "ring",      levelReq: 18 },
  { id: "wing1", name: "Feathered Wings",  stat: "power", boost: 12, cost: 260, slot: "wings",     levelReq: 22 },
  { id: "pet1",  name: "Young Wolf",       stat: "power", boost: 10, cost: 240, slot: "pet",       levelReq: 24 },
  { id: "syl1",  name: "Sylph Sprout",     stat: "power", boost: 15, cost: 320, slot: "sylph",     levelReq: 28 },
];

// unlock thresholds (client shows these too, but server is source of truth)
const SLOT_UNLOCK = {
  helm: 5, shoulders: 8, chest: 10, gloves: 12, boots: 15,
  ring: 18, wings: 22, pet: 24, sylph: 28
};
const PVP_UNLOCK = 25;

function ensure(uId) {
  if (!state[uId]) {
    const u = users.get(uId) || { id: uId, name: "Skald" };
    state[uId] = {
      id: u.id,
      name: u.name || "Skald",
      level: 1, xp: 0, gold: 100,
      power: 5, defense: 5, speed: 5,
      points: 0,
      gender: undefined,
      slots: {},
      gearPower: 0,
      lastTick: Date.now()
    };
  }
  return state[uId];
}

function tick(me) {
  const now = Date.now();
  const dt = Math.max(0, Math.floor((now - (me.lastTick || now)) / 1000));
  if (dt > 0) {
    me.gold += dt * 1; // +1 gold/sec
    me.xp   += Math.floor(dt / 5); // +1 xp/5s
    // level-up
    while (me.xp >= me.level * 100) {
      me.xp -= me.level * 100;
      me.level += 1;
      me.points += 3;
    }
    me.lastTick = now;
  }
  return me;
}

function recompute(me) {
  let gp = 0;
  if (me.slots) {
    for (const key of Object.keys(me.slots)) {
      const it = SHOP.find(i => i.id === me.slots[key]);
      if (it) gp += it.boost;
    }
  }
  me.gearPower = gp;
  return me;
}

function fightCalc(m) {
  const roll = () => (Math.random() * 10) - 5; // [-5,+5)
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

  // auth shim
  router.use((req, res, next) => {
    const uId = req.get("x-user-id");
    if (!uId) return res.status(401).json({ error: "Missing x-user-id" });
    req.userId = uId;
    next();
  });

  router.get("/game/me", (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    res.json({ me });
  });

  router.post("/game/tick", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    res.json({ me });
  });

  router.post("/game/train", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    const { stat } = req.body || {};
    if (!["power","defense","speed"].includes(stat))
      return res.status(400).json({ error: "Invalid stat" });
    if (me.gold < 2) return res.status(400).json({ error: "Not enough gold" });
    me.gold -= 2;
    me[stat] += 1;
    me.xp += 2;
    recompute(me);
    res.json({ me });
  });

  router.get("/game/shop", (req, res) => {
    res.json({ items: SHOP });
  });

  router.post("/game/gender", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    const { gender } = req.body || {};
    if (!["female","male"].includes(gender)) return res.status(400).json({ error:"Bad gender" });
    me.gender = gender;
    res.json({ me });
  });

  router.post("/game/shop/buy", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    const { itemId } = req.body || {};
    const item = SHOP.find(i => i.id === itemId);
    if (!item) return res.status(404).json({ error: "No such item" });

    // level req (for gear) + slot unlock
    if (item.levelReq && me.level < item.levelReq)
      return res.status(400).json({ error: `Requires level ${item.levelReq}` });
    if (item.slot && me.level < (SLOT_UNLOCK[item.slot] || 0))
      return res.status(400).json({ error: `Slot locked until level ${SLOT_UNLOCK[item.slot]}` });

    if (me.gold < item.cost) return res.status(400).json({ error: "Not enough gold" });

    me.gold -= item.cost;
    me[item.stat] += item.boost;

    if (item.slot) {
      me.slots[item.slot] = item.id; // auto-equip
      recompute(me);
    }
    res.json({ me, item });
  });

  router.post("/pvp/fight", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    if (me.level < PVP_UNLOCK) return res.status(400).json({ error: `PvP unlocks at level ${PVP_UNLOCK}` });

    const opp = pickRandomOpponent(req.userId);
    if (!opp) return res.status(400).json({ error: "No opponents yet. Get a friend to play!" });
    tick(opp); recompute(opp);

    const myBR = fightCalc(me);
    const opBR = fightCalc(opp);
    const win = myBR >= opBR;

    const deltaGold = win ? 25 : -10;
    const deltaXP   = win ? 50 : 15;

    me.gold = Math.max(0, me.gold + deltaGold);
    me.xp += deltaXP;
    // level-up after fight
    while (me.xp >= me.level * 100) {
      me.xp -= me.level * 100;
      me.level += 1;
      me.points += 3;
    }
    recompute(me);

    res.json({
      me,
      result: {
        win,
        opponent: { id: opp.id, name: opp.name, level: opp.level },
        deltaGold, deltaXP
      }
    });
  });

  app.use("/api", router);
}

module.exports = { install };

