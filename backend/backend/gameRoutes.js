// backend/gameRoutes.js
const express = require("express");
const fs = require("fs");
const path = require("path");
const { users } = require("./db");

// -------- In-memory game state --------
// state[userId] = { id, name, level, xp, gold, power, defense, speed, points, gender, slots, gearPower, lastTick }
const state = Object.create(null);

// ================== CATALOG LOADING ==================
const WINDOWS_CATALOG_PATH = "C:\\Users\\Lisa\\meadhall-site\\public\\guildbook\\catalogshop.json";
;
const FALLBACK_CATALOG_PATH = path.join(process.cwd(), "public", "guildbook", "catalogshop.json");
const CATALOG_PATH = process.env.SHOP_CATALOG_PATH || (fs.existsSync(WINDOWS_CATALOG_PATH) ? WINDOWS_CATALOG_PATH : FALLBACK_CATALOG_PATH);

let catalog = { sets: {}, items: [] };

function loadCatalogOnce(p) {
  try {
    const raw = fs.readFileSync(p, "utf8");
    const obj = JSON.parse(raw);
    if (!Array.isArray(obj.items)) obj.items = [];
    if (!obj.sets || typeof obj.sets !== "object") obj.sets = {};
    console.log(`🛡️ Loaded shop catalog from ${p}: ${obj.items.length} items, ${Object.keys(obj.sets).length} sets`);
    return obj;
  } catch (err) {
    console.error("⚠️ Failed to load catalog:", err.message);
    return { sets: {}, items: [] };
  }
}

catalog = loadCatalogOnce(CATALOG_PATH);

try {
  fs.watchFile(CATALOG_PATH, { interval: 2000 }, () => {
    console.log("♻️ Shop catalog changed, reloading...");
    catalog = loadCatalogOnce(CATALOG_PATH);
  });
} catch (e) {
  console.warn("fs.watchFile not available; catalog will not hot-reload.");
}

const getShop = () => catalog.items;
const getSetBonuses = () => {
  const bonuses = {};
  for (const [setId, setObj] of Object.entries(catalog.sets || {})) {
    bonuses[setId] = Array.isArray(setObj.bonuses) ? setObj.bonuses : [];
  }
  return bonuses;
};
const findItem = (id) => getShop().find(i => i.id === id);

// ================== GAME RULES ==================
const SLOT_UNLOCK = {
  helm: 5, shoulders: 8, chest: 10, gloves: 12, boots: 15,
  ring: 18, wings: 22, pet: 24, sylph: 28
};
const PVP_UNLOCK = 25;

// ---- Dev config ----
const DEV_KEY = process.env.DEV_KEY || "valhalla-dev";
function requireDev(req, res, next) {
  const k = req.get("x-dev-key");
  if (!k || k !== DEV_KEY) return res.status(403).json({ error: "Forbidden (dev key)" });
  next();
}

// Core helpers
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
    me.gold += dt * 1;
    me.xp += Math.floor(dt / 5);
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
  let gearBoostSum = 0;
  const countsBySet = {};
  if (me.slots) {
    for (const slot of Object.keys(me.slots)) {
      const itemId = me.slots[slot];
      const it = findItem(itemId);
      if (!it) continue;
      if (typeof it.boost === "number") gearBoostSum += it.boost;
      if (it.set) countsBySet[it.set] = (countsBySet[it.set] || 0) + 1;
    }
  }
  let setBonusPower = 0;
  const SET_BONUSES = getSetBonuses();
  for (const setId of Object.keys(countsBySet)) {
    const n = countsBySet[setId];
    const rules = SET_BONUSES[setId] || [];
    for (const r of rules) {
      if (n >= (r.pieces || 0)) {
        const p = r.bonus && r.bonus.power ? r.bonus.power : 0;
        setBonusPower += p;
      }
    }
  }
  me.gearPower = gearBoostSum + setBonusPower;
  return me;
}

function fightCalc(m) {
  const roll = () => (Math.random() * 10) - 5;
  return m.power * 1.0 + m.defense * 0.8 + m.speed * 0.6 + roll();
}
function pickRandomOpponent(myId) {
  const ids = Object.keys(state).filter(id => id !== myId);
  if (!ids.length) return null;
  const id = ids[Math.floor(Math.random() * ids.length)];
  return state[id];
}

// ================== INSTALL ==================
function install(app) {
  const router = express.Router();

  // auth shim
  router.use((req, res, next) => {
    const uId = req.get("x-user-id");
    if (!uId) return res.status(401).json({ error: "Missing x-user-id" });
    req.userId = uId;
    next();
  });

  // --- Info endpoints
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

  router.get("/game/shop", (req, res) => res.json({ items: getShop() }));

  router.get("/game/item/:id", (req, res) => {
    const it = findItem(req.params.id);
    if (!it) return res.status(404).json({ error: "No such item" });
    const info = {
      id: it.id,
      name: it.name,
      set: it.set,
      slot: it.slot,
      stat: it.stat,
      boost: it.boost,
      cost: it.cost,
      levelReq: it.levelReq,
      description: it.description || `A ${it.name}.`,
      imageUrl: it.imageUrl || `/guildbook/items/${it.id}.png`
    };
    res.json(info);
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
    const item = findItem(itemId);
    if (!item) return res.status(404).json({ error: "No such item" });
    if (item.levelReq && me.level < item.levelReq)
      return res.status(400).json({ error: `Requires level ${item.levelReq}` });
    if (item.slot && me.level < (SLOT_UNLOCK[item.slot] || 0))
      return res.status(400).json({ error: `Slot locked until level ${SLOT_UNLOCK[item.slot]}` });
    if (me.gold < item.cost) return res.status(400).json({ error: "Not enough gold" });
    me.gold -= item.cost;
    me[item.stat] += item.boost;
    if (item.slot) me.slots[item.slot] = item.id;
    recompute(me);
    res.json({ me, item });
  });

  router.post("/pvp/fight", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    if (me.level < PVP_UNLOCK) return res.status(400).json({ error: `PvP unlocks at level ${PVP_UNLOCK}` });
    const opp = pickRandomOpponent(req.userId);
    if (!opp) return res.status(400).json({ error: "No opponents yet." });
    tick(opp); recompute(opp);
    const myBR = fightCalc(me);
    const opBR = fightCalc(opp);
    const win = myBR >= opBR;
    const deltaGold = win ? 25 : -10;
    const deltaXP   = win ? 50 : 15;
    me.gold = Math.max(0, me.gold + deltaGold);
    me.xp += deltaXP;
    while (me.xp >= me.level * 100) {
      me.xp -= me.level * 100;
      me.level += 1;
      me.points += 3;
    }
    recompute(me);
    res.json({
      me,
      result: { win, opponent: { id: opp.id, name: opp.name, level: opp.level }, deltaGold, deltaXP }
    });
  });

  // ================== DEV ENDPOINTS ==================
  const dev = express.Router();
  dev.use(express.json());
  dev.use(requireDev);

  dev.get("/me", (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    res.json({ me, devKeyOk: true });
  });

  dev.post("/level", (req, res) => {
    const { level } = req.body || {};
    if (!Number.isFinite(level) || level < 1)
      return res.status(400).json({ error: "level must be >=1" });
    const me = ensure(req.userId);
    me.level = Math.floor(level);
    me.xp = 0;
    me.points = 3 * (me.level - 1);
    recompute(me);
    res.json({ me });
  });

  dev.post("/gold", (req, res) => {
    const { add, set } = req.body || {};
    const me = ensure(req.userId);
    if (Number.isFinite(set)) me.gold = Math.max(0, Math.floor(set));
    else if (Number.isFinite(add)) me.gold = Math.max(0, me.gold + Math.floor(add));
    else return res.status(400).json({ error: "Provide add or set" });
    res.json({ me });
  });

  dev.post("/xp", (req, res) => {
    const { add } = req.body || {};
    if (!Number.isFinite(add)) return res.status(400).json({ error: "add number" });
    const me = ensure(req.userId);
    me.xp += add;
    while (me.xp >= me.level * 100) {
      me.xp -= me.level * 100;
      me.level++;
      me.points += 3;
    }
    recompute(me);
    res.json({ me });
  });

  dev.post("/item", (req, res) => {
    const { itemId } = req.body || {};
    const it = findItem(itemId);
    if (!it) return res.status(404).json({ error: "No such item" });
    const me = ensure(req.userId);
    if (it.stat) me[it.stat] += it.boost || 0;
    if (it.slot) me.slots[it.slot] = it.id;
    recompute(me);
    res.json({ me, item: it });
  });

  dev.post("/slots", (req, res) => {
    const { slots } = req.body || {};
    const me = ensure(req.userId);
    if (typeof slots === "object") me.slots = { ...me.slots, ...slots };
    recompute(me);
    res.json({ me });
  });

  dev.post("/drengr", (req, res) => {
    const me = ensure(req.userId);
    const drengr = getShop().filter(i => i.set === "drengr");
    for (const it of drengr) {
      me[it.stat] += it.boost || 0;
      if (it.slot) me.slots[it.slot] = it.id;
    }
    recompute(me);
    res.json({ me, equipped: drengr.map(i => i.id) });
  });

  dev.post("/reset", (req, res) => {
    delete state[req.userId];
    res.json({ ok: true });
  });

  router.use("/dev", dev);

  // mount
  app.use("/api", router);
}

module.exports = { install };



