// Build maths: add up gear + refine + cards, then estimate damage per hit.
// Pure functions, shared by the page and the tests.
//
// The game's damage formula is not public. This uses the usual Ragnarok
// mobile shape, where each kind of bonus is its own multiplier, and the
// stat descriptions from the game data (e.g. "ATK% increases final P.ATK
// from gear"). Treat the number as an estimate; the % difference between
// two builds is the useful part.
import { expected } from "./refine.js";

export const SLOTS = [
  { id: "weapon", at: 5, label: "Weapon", card: "Weapon" },
  { id: "offhand", at: 6, label: "Off-Hand", card: "Off-Hand" },
  { id: "armor", at: 4, label: "Armor", card: "Armor" },
  { id: "cape", at: 7, label: "Cape", card: "Cape" },
  { id: "shoes", at: 8, label: "Shoes", card: "Shoes" },
  { id: "acc1", at: 9, label: "Accessory 1", card: "Accessory" },
  { id: "acc2", at: 9, label: "Accessory 2", card: "Accessory" },
  { id: "head", at: 1, label: "Headwear", card: "Headwear" },
  { id: "face", at: 2, label: "Facewear", card: "Facewear" },
  { id: "mouth", at: 3, label: "Mouthwear", card: "Mouthwear" },
  { id: "back", at: 12, label: "Backwear", card: "Backwear" },
  { id: "sh_armor", at: 21, label: "Shadow Armor", shadow: true },
  { id: "sh_shield", at: 22, label: "Shadow Shield", shadow: true },
  { id: "sh_gloves", at: 23, label: "Shadow Gloves", shadow: true },
  { id: "sh_shoes", at: 24, label: "Shadow Shoes", shadow: true },
  { id: "sh_earring", at: 25, label: "Shadow Earring", shadow: true },
  { id: "sh_pendant", at: 26, label: "Shadow Pendant", shadow: true },
];

export const RACES = ["Demi-Human", "Brute", "Demon", "Plant", "Undead", "Formless", "Fish", "Insect", "Angel", "Dragon", "Mech"];
export const SIZES = ["Small", "Medium", "Large"];
export const ELEMENTS = ["Neutral", "Water", "Earth", "Fire", "Wind", "Poison", "Holy", "Shadow", "Ghost", "Undead"];

// roll: "min" | "avg" | "max" for card effects written as a range (ATK +9~15)
function cardValue(min, max, roll) {
  if (roll === "min") return min;
  if (roll === "max") return max;
  return (min + max) / 2;
}

// build: { [slotId]: { item: id|null, refine: n, card: id|null } }
// lookup: { items: Map(id -> item), cards: Map(id -> card) }
export function sumStats(build, lookup, roll = "avg") {
  const t = {};
  const add = (k, v) => { t[k] = (t[k] || 0) + v; };
  const notes = [];
  for (const slot of SLOTS) {
    const s = build[slot.id];
    if (!s) continue;
    const item = s.item != null ? lookup.items.get(s.item) : null;
    if (item) {
      for (const [k, v] of item.fx || []) add(k, v);
      const r = Math.max(0, Math.min(20, Number(s.refine) || 0));
      for (const [k, v] of item.rfx || []) add(k, v * r);
    }
    const card = !slot.shadow && s.card != null ? lookup.cards.get(s.card) : null;
    if (card) {
      for (const [k, lo, hi] of card.fx || []) add(k, cardValue(lo, hi, roll));
      for (const line of card.other || []) notes.push(`${card.name}: ${line}`);
    }
  }
  // Extra lines: Apocalypse traits from the data, or a stat typed by hand
  // (Title, Relic, Pet, anything the game shows).
  for (const x of build.extras || []) {
    if (x.kind === "apoc" || x.kind === "affix") {
      const tr = (x.kind === "apoc" ? lookup.apoc : lookup.affix)?.get(x.id);
      if (!tr) continue;
      for (const [k, lo, hi] of tr.fx || []) add(k, cardValue(lo, hi, roll));
      const label = x.kind === "apoc" ? `Apocalypse ${tr.title}` : `Affix ${tr.name} L${tr.lv}`;
      for (const line of tr.other || []) notes.push(`${label}: ${line}`);
    } else if (x.kind === "cardaffix") {
      const o = lookup.cardaffix?.get(x.id);
      if (!o) continue;
      for (const [k, lo, hi] of o.fx || []) add(k, cardValue(lo, hi, roll));
      for (const line of o.other || []) notes.push(`Card affix: ${line}`);
    } else if (x.kind === "pet") {
      // a pet's bond level gives its owner a few stats
      const pet = lookup.pets?.get(x.id);
      const level = pet?.levels.find((l) => l.lv === Number(x.lv)) ?? pet?.levels.at(-1);
      for (const [k, v] of level?.fx || []) add(k, v);
    } else if (x.kind === "stat" && x.key && Number.isFinite(x.value)) {
      add(x.key, x.value);
    }
  }
  if (lookup.runes && Array.isArray(build.runes)) addRunes(build.runes, lookup.runes, roll, add, notes);
  for (const s of setBonuses(build, lookup)) for (const e of s.active) for (const [k, v] of e.fx) add(k, v);
  return { t, notes };
}

// Gear set bonuses. An effect needs `num` pieces of the set worn. Shadow sets
// also tier by quality: the weakest piece decides (all 6 Mythic -> the q6 line).
export function setBonuses(build, lookup) {
  const sets = lookup.sets;
  if (!sets) return [];
  const worn = new Map(); // set id -> { count, minQ, ids }
  for (const slot of SLOTS) {
    const id = build[slot.id]?.item;
    const item = id != null ? lookup.items.get(id) : null;
    for (const sid of item?.sets || []) {
      const w = worn.get(sid) || { count: 0, minQ: Infinity, ids: new Set() };
      if (w.ids.has(id)) continue; // the same piece in two slots (e.g. both accessories) counts once
      w.ids.add(id);
      w.count += 1;
      w.minQ = Math.min(w.minQ, item.q);
      worn.set(sid, w);
    }
  }
  const out = [];
  for (const [sid, w] of worn) {
    const set = sets[sid];
    if (!set) continue;
    const active = [];
    for (const num of [...new Set(set.effects.map((e) => e.num))]) {
      if (w.count < num) continue;
      const fits = set.effects.filter((e) => e.num === num && (e.q === 0 || e.q <= w.minQ));
      const best = fits.sort((a, b) => b.q - a.q)[0];
      if (best) active.push(best);
    }
    const need = Math.min(...set.effects.map((e) => e.num));
    out.push({ id: sid, name: set.name, count: w.count, need, pieces: set.pieces, minQ: w.minQ, active });
  }
  return out;
}

// Runes: random stats, main effect (counted only when switched on and it is a
// damage multiplier), and resonance from the colours of all runes together.
export function runeLevel(rune) {
  return Math.min(5, Math.max(1, Number(rune.lv) || 1) + (rune.celestial ? 1 : 0));
}
export function resonance(runes) {
  const count = {};
  for (const r of runes) {
    if (!r?.el) continue;
    for (const c of [r.el, ...(r.colors || [])]) if (c) count[c] = (count[c] || 0) + 1;
  }
  const tiers = {};
  for (const [el, n] of Object.entries(count)) tiers[el] = n >= 7 ? 7 : n >= 4 ? 4 : n >= 2 ? 2 : 0;
  return { count, tiers };
}
function addRunes(runes, R, roll, add, notes) {
  const stats = new Map(R.stats.map((x) => [x.attr, x]));
  const groups = new Map(R.groups.map((x) => [x.id, x]));
  for (const r of runes) {
    if (!r?.el) continue;
    const lib = R.levelLib[String(Math.max(1, Math.min(4, Number(r.lv) || 1)))];
    for (const attr of r.stats || []) {
      const st = stats.get(Number(attr));
      const range = st?.ranges[lib];
      if (st?.key && range) add(st.key, cardValue(range[0], range[1], roll));
    }
    const grp = groups.get(Number(r.group));
    if (grp) {
      const lv = runeLevel(r);
      if (r.count && grp.mult) add("mult", grp.mult[lv - 1]);
      else notes.push(`Rune ${grp.name} Lv${lv}: ${grp.levels[lv - 1]}`);
    }
  }
  const { tiers } = resonance(runes);
  for (const [el, tier] of Object.entries(tiers)) {
    const res = tier && R.elements[el]?.[String(tier)];
    if (!res) continue;
    for (const [k, v] of res.fx) add(k, v);
    notes.push(`${el} resonance (${tier}): ${res.lines.join(" ")}`);
  }
}

const g = (t, k) => t[k] || 0;

// ctx: { type: "melee"|"ranged"|"magic"|"magic-ranged", race, size, targetElement,
//        skillElement, skill (1 = 100%), baseAtk, baseMatk, critBase, targetReduction }
// ATK (or M.ATK) that comes from gear, cards, runes and extras.
export function gearAtk(t, magic) {
  return magic
    ? (g(t, "matk") + g(t, "rmatk")) * (1 + g(t, "matkp"))
    : (g(t, "atk") + g(t, "ratk")) * (1 + g(t, "atkp"));
}

// Start from the stats on the game's character screen instead of building the
// whole character from gear. The panel already includes everything you wear,
// so Now = panel and Plan = panel + (Plan slots - Now slots). Only the slots
// you change need to be filled in.
//   panel: { atk, matk, pdmg: 0.1, "race:Brute": 0.05, ... } (fractions for %)
export function withPanel(tNow, tPlan, panel) {
  const now = { ...tNow }, plan = { ...tPlan };
  const base = {};
  for (const [k, v] of Object.entries(panel || {})) {
    if (!Number.isFinite(v)) continue;
    if (k === "atk") { base.baseAtk = v - gearAtk(tNow, false); continue; }
    if (k === "matk") { base.baseMatk = v - gearAtk(tNow, true); continue; }
    const off = v - (tNow[k] || 0);
    now[k] = v;
    plan[k] = (tPlan[k] || 0) + off;
  }
  return { now, plan, base };
}

export function damage(t, ctx) {
  const magic = ctx.type === "magic" || ctx.type === "magic-ranged";
  const gearAtk_ = gearAtk(t, magic);
  // skill buffs like Assumptio raise total ATK by a %, on top of everything else
  const atk = ((magic ? ctx.baseMatk : ctx.baseAtk) + gearAtk_) * (1 + g(t, magic ? "matkall" : "atkall"));
  // skill % of ATK, plus the skill's own flat part ("400% + 400"), plus fixed damage
  let d = atk * (ctx.skill ?? 1) + (Number(ctx.skillFlat) || 0) + (magic ? g(t, "fixm") : g(t, "fixp")) + g(t, "fixall");
  d *= 1 + (magic ? g(t, "mdmg") : g(t, "pdmg"));
  if (ctx.type === "melee") d *= 1 + g(t, "melee");
  if (ctx.type === "ranged") d *= 1 + g(t, "ranged");
  if (ctx.type === "magic-ranged") d *= 1 + g(t, "rmagic");
  d *= 1 + g(t, `race:${ctx.race}`);
  d *= 1 + g(t, `size:${ctx.size}`) + g(t, "sizeall");
  d *= 1 + g(t, `elem:${ctx.skillElement}`) + g(t, "elemall");
  d *= 1 + g(t, `vselem:${ctx.targetElement}`);
  d *= 1 + g(t, "mult");
  d *= 1 - Math.min(0.8, Math.max(0, ctx.targetReduction || 0));
  d = Math.max(0, d);
  const crit = magic ? null : d * ((ctx.critBase ?? 1.5) + g(t, "critdmg"));
  return { atk, hit: d, crit };
}

// Skill buffs picked by job, skill and level: the stats their text gives at
// that level, plus the text of anything that is not a plain stat.
//   picks: [{ id, lv }]   data: buffs.json ({ skills: [...] })
export function skillBuffStats(picks, data) {
  const byId = new Map((data?.skills || []).map((s) => [s.id, s]));
  const fx = [], notes = [];
  for (const p of picks || []) {
    const sk = byId.get(Number(p.id));
    if (!sk) continue;
    const lv = Math.max(1, Math.min(sk.levels.length, Number(p.lv) || 1));
    const level = sk.levels[lv - 1];
    fx.push(...level.fx);
    if (!level.fx.length) notes.push(`${sk.name} Lv${lv}: ${level.desc}`);
  }
  return { fx, notes };
}

// Average Starstones to refine the Plan from where Now is. A slot with a
// different item in Plan is counted from +0.
export function upgradeStarstones(now, plan, refineData) {
  let stars = 0;
  for (const slot of SLOTS) {
    const p = plan[slot.id];
    if (!p || p.item == null) continue;
    const n = now[slot.id];
    const from = n && n.item === p.item ? Number(n.refine) || 0 : 0;
    const to = Number(p.refine) || 0;
    if (to > from) stars += expected(refineData, from, to).starstones;
  }
  return stars;
}
