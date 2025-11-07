// ===============================
// backend/gameRoutes.js — FINAL
// ===============================
const express = require("express");
const fs = require("fs");
const path = require("path");
const { users } = require("./db");

// ================== IN-MEMORY GAME STATE ==================
const state = Object.create(null);

// ================== CATALOG LOADING ==================
const FILENAME = "catalogshop.json";
const WINDOWS_CATALOG_PATH =
  "C:\\Users\\Lisa\\meadhall-site\\public\\guildbook\\" + FILENAME;
const RENDER_PUBLIC = path.resolve(
  __dirname,
  "..",
  "..",
  "public",
  "guildbook",
  FILENAME
);
const ENV_PATH = process.env.SHOP_CATALOG_PATH;

function pickCatalogPath() {
  const candidates = [ENV_PATH, WINDOWS_CATALOG_PATH, RENDER_PUBLIC].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return RENDER_PUBLIC;
}

let CATALOG_PATH = pickCatalogPath();
let catalog = { sets: {}, items: [] };

function loadCatalogOnce(p) {
  try {
    const raw = fs.readFileSync(p, "utf8");
    const obj = JSON.parse(raw);
    if (!Array.isArray(obj.items)) obj.items = [];
    if (!obj.sets || typeof obj.sets !== "object") obj.sets = {};
    console.log(`🛒 Catalog loaded: ${p} — ${obj.items.length} items, ${Object.keys(obj.sets).length} sets`);
    return obj;
  } catch (err) {
    console.warn("⚠️ Failed to load catalog:", p, err.message);
    return { sets: {}, items: [] };
  }
}

catalog = loadCatalogOnce(CATALOG_PATH);
try {
  fs.watchFile(CATALOG_PATH, { interval: 2000 }, () => {
    console.log("♻️ Shop catalog changed, reloading...");
    catalog = loadCatalogOnce(CATALOG_PATH);
  });
} catch {}

// helpers
const getShop = () => catalog.items;
const getSetBonuses = () => {
  const out = {};
  for (const [setId, setObj] of Object.entries(catalog.sets || {})) {
    out[setId] = Array.isArray(setObj.bonuses) ? setObj.bonuses : [];
  }
  return out;
};
const findItem = (id) => getShop().find((i) => i.id === id);

// ---- Brísingr helpers
const diamondCost = (it) =>
  Number.isFinite(it?.costDiamonds) ? it.costDiamonds :
  Number.isFinite(it?.costDiamond)  ? it.costDiamond  : null;

const getBrisingrShop = () =>
  (catalog.items || []).filter(i => Number.isFinite(diamondCost(i)));

// ================== GAME RULES ==================
const SLOT_UNLOCK = {
  helm: 5, shoulders: 8, chest: 10, gloves: 12, boots: 15,
  ring: 18, wings: 22, pet: 24, sylph: 28,
  weapon: 1, // ← add this so weapons are available from level 1
};

const PVP_UNLOCK = 25;

// ================== DEV KEY ==================
const DEV_KEY = process.env.DEV_KEY || "valhalla-dev";
function requireDev(req, res, next) {
  const k = req.get("x-dev-key");
  if (!k || k !== DEV_KEY)
    return res.status(403).json({ error: "Forbidden (dev key)" });
  next();
}

// ================== HELPERS ==================
function ensure(uId) {
  if (!state[uId]) {
    const u = users.get(uId) || { id: uId, name: "Skald" };
    state[uId] = {
      id: u.id,
      name: u.name || "Skald",
      level: 1,
      xp: 0,
      gold: 100,
      brisingr: 0,        // ← Brísingr balance
      power: 5,
      defense: 5,
      speed: 5,
      points: 0,
      gender: undefined,
      renameUsed: false,
      slots: {},
      gearPower: 0,
      battleRating: 15,
      lastTick: Date.now(),
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
      me.level++;
      me.points += 3;
    }
    me.lastTick = now;
  }
  return me;
}

// ---- recompute total stats ----
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
        const p = r.bonus?.power || 0;
        setBonusPower += p;
      }
    }
  }
  me.gearPower = gearBoostSum + setBonusPower;

  // Final BR = all stats + gearPower
  me.battleRating = (me.power + me.defense + me.speed + me.gearPower) | 0;
  return me;
}

function fightCalc(m) {
  const roll = () => Math.random() * 10 - 5;
  return m.power * 1 + m.defense * 0.8 + m.speed * 0.6 + roll();
}

function pickRandomOpponent(myId) {
  const ids = Object.keys(state).filter((id) => id !== myId);
  if (!ids.length) return null;
  const id = ids[Math.floor(Math.random() * ids.length)];
  return state[id];
}

// gender restriction helper
function violatesGenderLock(me, item) {
  if (!item.set) return false;
  if (item.set === "drengr" && me.gender === "female") return true;
  if (item.set === "skjaldmey" && me.gender === "male") return true;
  return false;
}

// ================== ROUTES ==================
function install(app) {
  const router = express.Router();

  router.use((req, res, next) => {
    const uId = req.get("x-user-id");
    if (!uId) return res.status(401).json({ error: "Missing x-user-id" });
    req.userId = uId;
    next();
  });

  // ---- Info
  router.get("/game/me", (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    res.json({ me });
  });
  router.post("/game/tick", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    console.log("[/game/me]", req.userId, "slots:", me.slots);

    res.json({ me });
  });

  // ---- Train
  router.post("/game/train", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    const { stat } = req.body || {};
    if (!["power", "defense", "speed"].includes(stat))
      return res.status(400).json({ error: "Invalid stat" });
    if (me.gold < 2)
      return res.status(400).json({ error: "Not enough gold" });
    me.gold -= 2;
    me[stat] += 1;
    me.xp += 2;
    recompute(me);
    res.json({ me });
  });

  // ---- Allocate points
  router.post("/game/allocate", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    const { stat, amount } = req.body || {};
    if (!["power", "defense", "speed"].includes(stat))
      return res.status(400).json({ error: "Invalid stat" });
    const amt = Math.max(1, Math.floor(Number(amount || 1)));
    if ((me.points || 0) < amt)
      return res.status(400).json({ error: "Not enough points" });
    me.points -= amt;
    me[stat] += amt;
    recompute(me);
    res.json({ me });
  });

  // ---- Rename hero
  router.post("/game/rename", express.json(), (req, res) => {
    const me = ensure(req.userId);
    const { name } = req.body || {};
    if (!name || typeof name !== "string" || name.length > 20)
      return res.status(400).json({ error: "Invalid name" });
    if (me.renameUsed)
      return res.status(400).json({ error: "Rename already used" });
    me.name = name.trim();
    me.renameUsed = true;
    res.json({ me });
  });

  // ---- Gender select
  router.post("/game/gender", express.json(), (req, res) => {
    const me = ensure(req.userId);
    const { gender } = req.body || {};
    if (!["female", "male"].includes(gender))
      return res.status(400).json({ error: "Bad gender" });
    me.gender = gender;
    recompute(me);
    res.json({ me });
  });

  // ---- Gold Shop
  router.get("/game/shop", (req, res) => res.json({ items: getShop() }));
  router.get("/game/item/:id", (req, res) => {
    const it = findItem(req.params.id);
    if (!it) return res.status(404).json({ error: "No such item" });
    res.json(it);
  });

  router.post("/game/shop/buy", express.json(), (req, res) => {
  try {
    const me = recompute(tick(ensure(req.userId)));
    const { itemId } = req.body || {};
    const item = findItem(itemId);
    if (!item) return res.status(404).json({ error: "No such item" });

    // diamond items must use brisingr route
    if (Number.isFinite(diamondCost(item))) {
      return res.status(400).json({ error: "Use Brísingr shop for this item" });
    }

    if (violatesGenderLock(me, item)) {
      return res.status(400).json({
        error: item.set === "drengr" ? "Drengr gear is male only" : "Skjaldmey gear is female only",
      });
    }

    if (item.levelReq && me.level < item.levelReq) {
      return res.status(400).json({ error: `Requires level ${item.levelReq}` });
    }
    if (item.slot && me.level < (SLOT_UNLOCK[item.slot] || 0)) {
      return res.status(400).json({ error: `Slot locked until level ${SLOT_UNLOCK[item.slot]}` });
    }

    // idempotent: already wearing it
    if (item.slot && me.slots[item.slot] === item.id) {
      return res.json({ me: recompute(me), item });
    }

    if (me.gold < item.cost) return res.status(400).json({ error: "Not enough gold" });

    // swap: remove previous boost if replacing
    if (item.slot) {
      const prevId = me.slots[item.slot];
      if (prevId) {
        const prev = findItem(prevId);
        if (prev?.stat) me[prev.stat] = Math.max(0, (me[prev.stat] || 0) - (prev.boost || 0));
      }
      me.slots[item.slot] = item.id;
    }

    if (item.stat) me[item.stat] = (me[item.stat] || 0) + (item.boost || 0);
    me.gold -= item.cost;

    recompute(me);
    return res.json({ me, item });
  } catch (e) {
    console.error("💥 /game/shop/buy error:", e);
    return res.status(500).json({ ok:false, error: String(e.message || e) });
  }
});




    

  // ---- Brísingr (Diamond) Shop
    // === Brísingr Recharge Checkout (Stripe) ===
  router.post("/game/checkout/brisingr/:tier", express.json(), async (req, res) => {
    try {
      const { tier } = req.params;
      const { userId } = req.body || {};
      const xuid = req.get("x-user-id") || userId;
      if (!xuid) return res.status(400).json({ error: "Missing x-user-id" });

      // Map tiers → Stripe Price IDs
      const PRICES = {
        "100":   process.env.STRIPE_PRICE_READER,   // $0.99
        "500":   process.env.STRIPE_PRICE_PREMIUM,  // $4.99
        "1000":  process.env.STRIPE_PRICE_ANNUAL,   // $9.99
         "2000": process.env.STRIPE_PRICE_2000,
         "5000": process.env.STRIPE_PRICE_5000,
         "10000": process.env.STRIPE_PRICE_10000,
      };

      const priceId = PRICES[tier];
      if (!priceId) return res.status(400).json({ error: `Unknown tier: ${tier}` });

      const stripe = require("stripe")(process.env.STRIPE_SECRET);

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${process.env.CLIENT_URL}/game.html?success=1`,
        cancel_url: `${process.env.CLIENT_URL}/brisingrshop.html?cancel=1`,
        metadata: { userId: xuid, tier },
      });

      res.json({ url: session.url });
    } catch (err) {
      console.error("Stripe checkout error:", err);
      res.status(500).json({ error: err.message || String(err) });
    }
  });

  router.get("/game/brisingr-shop", (req, res) => {
    res.json({ items: getBrisingrShop() });
  });

  router.post("/game/brisingr/buy", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    const { itemId } = req.body || {};
    const item = findItem(itemId);
    if (!item) return res.status(404).json({ error: "No such item" });
    // No-op if already equipped in that slot
if (item.slot && me.slots[item.slot] === item.id) {
  return res.status(200).json({ me, item });
}


    const dCost = diamondCost(item);
    if (!Number.isFinite(dCost))
      return res.status(400).json({ error: "This is not a Brísingr item" });

    if (violatesGenderLock(me, item))
      return res.status(400).json({
        error:
          item.set === "drengr"
            ? "Drengr gear is male only"
            : "Skjaldmey gear is female only",
      });

    if (item.levelReq && me.level < item.levelReq)
      return res.status(400).json({ error: `Requires level ${item.levelReq}` });
    if (item.slot && me.level < (SLOT_UNLOCK[item.slot] || 0))
      return res
        .status(400)
        .json({ error: `Slot locked until level ${SLOT_UNLOCK[item.slot]}` });

    if ((me.brisingr ?? 0) < dCost)
      return res.status(400).json({ error: "Not enough Brísingr" });

    me.brisingr -= dCost;
    if (item.stat) me[item.stat] += item.boost || 0;
    if (item.slot) me.slots[item.slot] = item.id;
    recompute(me);
    res.json({ me, item });
  });

  // ---- PvP
  router.post("/pvp/fight", express.json(), (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    if (me.level < PVP_UNLOCK)
      return res
        .status(400)
        .json({ error: `PvP unlocks at level ${PVP_UNLOCK}` });

    const opp = pickRandomOpponent(req.userId);
    if (!opp)
      return res
        .status(400)
        .json({ error: "No opponents yet. Get a friend to play!" });

    tick(opp);
    recompute(opp);

    const myBR = fightCalc(me);
    const opBR = fightCalc(opp);
    const win = myBR >= opBR;

    const deltaGold = win ? 25 : -10;
    const deltaXP = win ? 50 : 15;

    me.gold = Math.max(0, me.gold + deltaGold);
    me.xp += deltaXP;
    while (me.xp >= me.level * 100) {
      me.xp -= me.level * 100;
      me.level++;
      me.points += 3;
    }
    recompute(me);

    res.json({
      me,
      result: {
        win,
        opponent: { id: opp.id, name: opp.name, level: opp.level },
        deltaGold,
        deltaXP,
      },
    });
  });

  // ================== DEV ==================
  const dev = express.Router();
  dev.use(express.json());
  dev.use(requireDev);

  dev.get("/me", (req, res) => {
    const me = recompute(tick(ensure(req.userId)));
    res.json({ me, catalogPath: CATALOG_PATH });
  });
  dev.post("/level", (req, res) => {
    const { level } = req.body || {};
    const me = ensure(req.userId);
    me.level = Math.max(1, Math.floor(level || 1));
    me.points = 3 * (me.level - 1);
    recompute(me);
    res.json({ me });
  });
  dev.post("/gold", (req, res) => {
    const { add, set } = req.body || {};
    const me = ensure(req.userId);
    if (Number.isFinite(set)) me.gold = Math.max(0, set);
    else if (Number.isFinite(add)) me.gold += add;
    res.json({ me });
  });
  dev.post("/brisingr", (req, res) => {
    const { add, set } = req.body || {};
    const me = ensure(req.userId);
    if (Number.isFinite(set)) me.brisingr = Math.max(0, set);
    else if (Number.isFinite(add)) me.brisingr = Math.max(0, (me.brisingr || 0) + add);
    res.json({ me });
  });
  dev.post("/xp", (req, res) => {
    const { add } = req.body || {};
    const me = ensure(req.userId);
    me.xp += Math.floor(add || 0);
    while (me.xp >= me.level * 100) {
      me.xp -= me.level * 100;
      me.level++;
      me.points += 3;
    }
    recompute(me);
    res.json({ me });
  });
  dev.post("/points", (req, res) => {
    const { add } = req.body || {};
    const me = ensure(req.userId);
    me.points = (me.points || 0) + (add || 0);
    recompute(me);
    res.json({ me });
  });
  dev.post("/item", (req, res) => {
  const { itemId } = req.body || {};
  const me = ensure(req.userId);
  const it = findItem(itemId);
  if (!it) return res.status(404).json({ error: "No such item" });
  if (violatesGenderLock(me, it)) return res.status(400).json({ error: "Gender restricted item" });

  // idempotent for slotted gear + proper swap
  if (it.slot) {
    const prevId = me.slots[it.slot];
    if (prevId === it.id) {
      return res.json({ me: recompute(me), item: it });
    }
    if (prevId) {
      const prev = findItem(prevId);
      if (prev?.stat) me[prev.stat] = Math.max(0, (me[prev.stat] || 0) - (prev.boost || 0));
    }
    me.slots[it.slot] = it.id;
  }

  if (it.stat) me[it.stat] = (me[it.stat] || 0) + (it.boost || 0);

  recompute(me);
  return res.json({ me, item: it });
});



  dev.post("/slots", (req, res) => {
    const { slots } = req.body || {};
    const me = ensure(req.userId);
    me.slots = { ...me.slots, ...slots };
    recompute(me);
    res.json({ me });
  });
  dev.post("/equip-set", (req, res) => {
  const { setId } = req.body || {};
  const me = ensure(req.userId);
  const items = getShop().filter(i => i.set === setId);

  const nextEquipped = [];
  for (const it of items) {
    if (violatesGenderLock(me, it)) continue;

    // already equipped? skip
    if (it.slot && me.slots[it.slot] === it.id) {
      nextEquipped.push(it.id);
      continue;
    }

    // swap remove previous boost
    if (it.slot) {
      const prevId = me.slots[it.slot];
      if (prevId) {
        const prev = findItem(prevId);
        if (prev?.stat) me[prev.stat] = Math.max(0, (me[prev.stat] || 0) - (prev.boost || 0));
      }
      me.slots[it.slot] = it.id;
    }

    if (it.stat) me[it.stat] = (me[it.stat] || 0) + (it.boost || 0);
    nextEquipped.push(it.id);
  }

  recompute(me);
  res.json({ me, equipped: nextEquipped });
});


  
  dev.post("/reset", (req, res) => {
    delete state[req.userId];
    res.json({ ok: true });
  });

  router.use("/dev", dev);
  app.use("/api", router);
    // Expose credit helper for webhook usage
  app.locals.brisingrCredit = (userId, amount) => {
    const u = users.get(userId);
    if (!u) {
      console.warn(`⚠️ User ${userId} not found for Brísingr credit`);
      return;
    }
    const add = Number(amount || 0);

    // Update in-memory state if present
    const me = state[userId];
    if (me) me.brisingr = (me.brisingr || 0) + add;

    // Persist to users map
    u.brisingr = (u.brisingr || 0) + add;
    users.set(u.id, u);

    console.log(`💰 Added ${add} Brísingr to ${u.name || u.id}`);
  };

}
// --- Expose credit helper for Stripe webhook ---
app.locals.brisingrCredit = (userId, amount) => {
  const u = users.get(userId);
  if (!u) {
    console.warn(`⚠️ User ${userId} not found for Brísingr credit`);
    return;
  }

  // If the user exists in the in-memory state too, update both
  const me = state[userId];
  if (me) {
    me.brisingr = (me.brisingr || 0) + Number(amount || 0);
  }

  // Persist to users map (for long-term data)
  u.brisingr = (u.brisingr || 0) + Number(amount || 0);
  users.set(u.id, u);

  console.log(`💰 Added ${amount} Brísingr to ${u.name} (${u.id})`);
};


module.exports = { install };



















