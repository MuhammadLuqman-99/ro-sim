import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { sumStats, damage, upgradeStarstones, resonance, runeLevel, withPanel, skillBuffStats, setBonuses } from "../web/lib/build.js";

const items = new Map([
  [1, { id: 1, fx: [["atk", 100]], rfx: [["ratk", 6], ["fixp", 5]] }],
  [2, { id: 2, fx: [["atk", 50], ["atkp", 0.1]], rfx: [] }],
]);
const cards = new Map([
  [10, { id: 10, name: "Hydra", fx: [["race:Demi-Human", 0.12, 0.2]], other: [] }],
  [11, { id: 11, name: "Cramp", fx: [["atk", 9, 15]], other: ["Unique: something"] }],
]);
const apoc = new Map([[7, { id: 7, title: "ATK", fx: [["atk", 49, 73]], other: [] }],
  [8, { id: 8, title: "Combo", fx: [], other: ["Combo Skill DMG +5%"] }]]);
const affix = new Map([[3, { id: 3, name: "Cold Bloodline", lv: 1, fx: [["elem:Water", 0.006, 0.006]], other: [] }],
  [4, { id: 4, name: "Sharp Aura", lv: 2, fx: [], other: ["During Aura Blade, PDMG +8%."] }]]);
const cardaffix = new Map([["random:6011003", { text: "ATK +4~6", fx: [["atk", 4, 6]], other: [] }]]);
const lookup = { items, cards, apoc, affix, cardaffix };
const ctx = { type: "melee", race: "Brute", size: "Medium", targetElement: "Neutral", skillElement: "Neutral",
  skill: 1, baseAtk: 100, baseMatk: 100, critBase: 1.5, targetReduction: 0 };

test("gear, refine and card stats add up per slot", () => {
  const { t, notes } = sumStats({ weapon: { item: 1, refine: 10, card: 11 } }, lookup, "max");
  assert.equal(t.atk, 115);
  assert.equal(t.ratk, 60);
  assert.equal(t.fixp, 50);
  assert.deepEqual(notes, ["Cramp: Unique: something"]);
});

test("card ranges follow the min / avg / max choice", () => {
  const b = { head: { item: null, refine: 0, card: 11 } };
  assert.equal(sumStats(b, lookup, "min").t.atk, 9);
  assert.equal(sumStats(b, lookup, "avg").t.atk, 12);
  assert.equal(sumStats(b, lookup, "max").t.atk, 15);
});

test("shadow slots ignore cards", () => {
  const { t } = sumStats({ sh_gloves: { item: 2, refine: 0, card: 11 } }, lookup);
  assert.equal(t.atk, 50);
});

test("ATK% only multiplies ATK from gear, not base ATK", () => {
  const { t } = sumStats({ weapon: { item: 2, refine: 0 } }, lookup);
  const d = damage(t, ctx);
  assert.equal(d.atk, 100 + 50 * 1.1);
});

test("race bonus only counts against that race", () => {
  const build = { weapon: { item: 1, refine: 0, card: 10 } };
  const { t } = sumStats(build, lookup, "max");
  const vsBrute = damage(t, ctx).hit;
  const vsHuman = damage(t, { ...ctx, race: "Demi-Human" }).hit;
  assert.ok(Math.abs(vsHuman / vsBrute - 1.2) < 1e-9);
});

test("crit uses the base multiplier plus CRIT DMG%, magic has no crit", () => {
  const t = { atk: 0, critdmg: 0.1 };
  const d = damage(t, ctx);
  assert.ok(Math.abs(d.crit / d.hit - 1.6) < 1e-9);
  assert.equal(damage(t, { ...ctx, type: "magic" }).crit, null);
});

test("target damage reduction is capped at 80%", () => {
  const t = {};
  assert.ok(Math.abs(damage(t, { ...ctx, targetReduction: 0.95 }).hit - 20) < 1e-9);
});

const path = new URL("../web/data/refine.json", import.meta.url);
const refine = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;

test("upgrade cost counts only the extra refine, and a new item from +0", { skip: refine ? false : "no data" }, () => {
  const now = { weapon: { item: 1, refine: 6 } };
  const same = upgradeStarstones(now, { weapon: { item: 1, refine: 9 } }, refine);
  const fresh = upgradeStarstones(now, { weapon: { item: 2, refine: 9 } }, refine);
  const down = upgradeStarstones(now, { weapon: { item: 1, refine: 3 } }, refine);
  assert.ok(same > 0 && fresh > same);
  assert.equal(down, 0);
});

test("extra lines: Apocalypse traits roll like cards, typed stats add as given", () => {
  const b = { extras: [{ kind: "apoc", id: 7 }, { kind: "stat", key: "pdmg", value: 0.05, label: "Title" }, { kind: "apoc", id: 8 }] };
  const { t, notes } = sumStats(b, lookup, "max");
  assert.equal(t.atk, 73);
  assert.equal(t.pdmg, 0.05);
  assert.deepEqual(notes, ["Apocalypse Combo: Combo Skill DMG +5%"]);
});

test("unknown or broken extra lines are skipped", () => {
  const b = { extras: [{ kind: "apoc", id: 999 }, { kind: "stat", key: "atk", value: NaN }, { kind: "x" }] };
  assert.deepEqual(sumStats(b, lookup).t, {});
});

test("equipment affixes: plain stats count, conditional ones become notes", () => {
  const { t, notes } = sumStats({ extras: [{ kind: "affix", id: 3 }, { kind: "affix", id: 4 }] }, lookup);
  assert.equal(t["elem:Water"], 0.006);
  assert.deepEqual(notes, ["Affix Sharp Aura L2: During Aura Blade, PDMG +8%."]);
});

test("card affixes from fusion roll like card effects", () => {
  const { t } = sumStats({ extras: [{ kind: "cardaffix", id: "random:6011003" }] }, lookup, "max");
  assert.equal(t.atk, 6);
});

const R = {
  levelLib: { 1: "33", 2: "43", 3: "53", 4: "53" },
  stats: [{ attr: 28, key: "atk", ranges: { 33: [10, 16], 43: [16, 24], 53: [28, 42] } }],
  groups: [{ id: 10005, name: "Single-Target Amplification", levels: ["a2", "a4", "a6", "a8", "a10"], mult: [0.02, 0.04, 0.06, 0.08, 0.1] },
           { id: 10018, name: "Featherlight", levels: ["f1", "f2", "f3", "f4", "f5"], mult: null }],
  elements: { Aqua: { 2: { lines: ["P/M DMG +2%"], fx: [["pdmg", 0.02], ["mdmg", 0.02]] }, 4: { lines: ["+4%"], fx: [["pdmg", 0.04], ["mdmg", 0.04]] }, 7: { lines: ["+6%"], fx: [["pdmg", 0.06], ["mdmg", 0.06]] } } },
};

test("resonance counts colours across runes and only the highest tier applies", () => {
  const runes = [{ el: "Aqua", colors: ["Aqua", "Pyro"] }, { el: "Aqua", colors: ["Gale", "Gale"] }];
  const { count, tiers } = resonance(runes);
  assert.equal(count.Aqua, 3);
  assert.equal(tiers.Aqua, 2);
  assert.equal(tiers.Gale, 2);
  assert.equal(tiers.Pyro, 0);
  const { t } = sumStats({ runes: [...runes, { el: "Aqua", colors: [] }] }, { ...lookup, runes: R });
  assert.equal(t.pdmg, 0.04); // 4 Aqua colours -> tier 4 only, not 2 + 4
});

test("Celestial lifts the main effect one level, capped at 5", () => {
  assert.equal(runeLevel({ lv: 3, celestial: true }), 4);
  assert.equal(runeLevel({ lv: 4, celestial: true }), 5);
  assert.equal(runeLevel({ lv: 2 }), 2);
});

test("rune effect counts as a damage multiplier only when switched on", () => {
  const on = sumStats({ runes: [{ el: "Aqua", lv: 4, celestial: true, group: 10005, count: true, stats: [28] }] }, { ...lookup, runes: R }, "max");
  assert.equal(on.t.mult, 0.1);
  assert.equal(on.t.atk, 42);
  const off = sumStats({ runes: [{ el: "Aqua", lv: 1, group: 10005, count: false }] }, { ...lookup, runes: R });
  assert.equal(off.t.mult, undefined);
  assert.ok(off.notes.some((n) => n.startsWith("Rune Single-Target Amplification Lv1")));
  const hit = damage({ mult: 0.1 }, ctx).hit / damage({}, ctx).hit;
  assert.ok(Math.abs(hit - 1.1) < 1e-9);
});

test("panel mode: Now equals the character screen, Plan moves by the gear difference only", () => {
  const tNow = { atk: 100, atkp: 0.1, pdmg: 0.02 };          // the slot you are swapping out
  const tPlan = { atk: 150, atkp: 0.1, pdmg: 0.05 };         // the slot you would swap in
  const panel = { atk: 2000, pdmg: 0.3, critdmg: 0.5 };      // as typed from the game
  const { now, plan, base } = withPanel(tNow, tPlan, panel);
  const dn = damage(now, { ...ctx, ...base });
  const dp = damage(plan, { ...ctx, ...base });
  assert.equal(dn.atk, 2000);                                // Now ATK is exactly the panel
  assert.ok(Math.abs(dp.atk - (2000 + 50 * 1.1)) < 1e-9);    // Plan adds only the gear change
  assert.ok(Math.abs(now.pdmg - 0.3) < 1e-12);
  assert.ok(Math.abs(plan.pdmg - 0.33) < 1e-12);
  assert.equal(plan.critdmg, 0.5);                           // untouched stats carry over
});

test("panel mode ignores empty boxes", () => {
  const { now, base } = withPanel({ pdmg: 0.02 }, { pdmg: 0.02 }, { atk: NaN, pdmg: NaN });
  assert.equal(now.pdmg, 0.02);
  assert.deepEqual(base, {});
});

test("skill buffs give the stats of the chosen level; text-only buffs become notes", () => {
  const data = { skills: [
    { id: 1, name: "Assumptio", levels: [{ desc: "+4%", fx: [["atkall", 0.04]] }, { desc: "+8%", fx: [["atkall", 0.08]] }] },
    { id: 2, name: "Maximized Weapon", levels: [{ desc: "Maximizes variance", fx: [] }] },
  ] };
  const r = skillBuffStats([{ id: 1, lv: 2 }, { id: 2, lv: 1 }, { id: 9, lv: 1 }, { id: 1, lv: 99 }], data);
  assert.deepEqual(r.fx, [["atkall", 0.08], ["atkall", 0.08]]);  // level is capped at the max
  assert.deepEqual(r.notes, ["Maximized Weapon Lv1: Maximizes variance"]);
});

test("ATK% of total (e.g. Assumptio) multiplies all ATK, not just gear", () => {
  const d = damage({ atk: 100, atkall: 0.1 }, ctx);
  assert.ok(Math.abs(d.atk - (100 + 100) * 1.1) < 1e-9);
});

test("shadow set: needs all 6 pieces, and the weakest piece picks the tier", () => {
  const sh = (id, q) => [id, { id, q, fx: [], rfx: [], sets: [77] }];
  const items2 = new Map([sh(1, 6), sh(2, 6), sh(3, 6), sh(4, 6), sh(5, 6), sh(6, 5), sh(7, 6)]);
  const sets = { 77: { name: "Shadow Edge", pieces: 6, effects: [
    { num: 6, q: 3, fx: [["melee", 0.005]] }, { num: 6, q: 4, fx: [["melee", 0.01]] },
    { num: 6, q: 5, fx: [["melee", 0.02]] }, { num: 6, q: 6, fx: [["melee", 0.04]] }] } };
  const L = { items: items2, cards: new Map(), sets };
  const five = { sh_armor: { item: 1 }, sh_shield: { item: 2 }, sh_gloves: { item: 3 }, sh_shoes: { item: 4 }, sh_earring: { item: 5 } };
  assert.equal(sumStats(five, L).t.melee, undefined);                          // 5 of 6: nothing
  assert.equal(sumStats({ ...five, sh_pendant: { item: 7 } }, L).t.melee, 0.04);  // all Mythic
  assert.equal(sumStats({ ...five, sh_pendant: { item: 6 } }, L).t.melee, 0.02);  // one Legend piece
  const info = setBonuses({ ...five, sh_pendant: { item: 6 } }, L)[0];
  assert.deepEqual([info.count, info.need, info.minQ], [6, 6, 5]);
});

test("3-piece set with a single any-quality bonus", () => {
  const it = (id) => [id, { id, q: 4, fx: [], rfx: [], sets: [9] }];
  const L = { items: new Map([it(1), it(2), it(3)]), cards: new Map(),
    sets: { 9: { name: "Gale Set I", pieces: 3, effects: [{ num: 3, q: 0, fx: [["pdmg", 0.02]] }] } } };
  assert.equal(sumStats({ armor: { item: 1 }, cape: { item: 2 }, shoes: { item: 3 } }, L).t.pdmg, 0.02);
  assert.equal(sumStats({ armor: { item: 1 }, cape: { item: 2 } }, L).t.pdmg, undefined);
});

test("a skill's flat part is added after the skill %", () => {
  const t = { atk: 0 };
  const base = damage(t, { ...ctx, skill: 4 }).hit;          // 100 base ATK × 400%
  assert.equal(base, 400);
  assert.equal(damage(t, { ...ctx, skill: 4, skillFlat: 400 }).hit, 800);
});

test("a pet adds the stats of its bond level, or its top level if the level is unknown", () => {
  const pets = new Map([[5, { id: 5, levels: [{ lv: 0, fx: [] }, { lv: 1, fx: [["atk", 1], ["hp", 35]] }, { lv: 2, fx: [["atk", 2], ["hp", 70]] }] }]]);
  assert.deepEqual(sumStats({ extras: [{ kind: "pet", id: 5, lv: 1 }] }, { ...lookup, pets }).t, { atk: 1, hp: 35 });
  assert.deepEqual(sumStats({ extras: [{ kind: "pet", id: 5, lv: 99 }] }, { ...lookup, pets }).t, { atk: 2, hp: 70 });
  assert.deepEqual(sumStats({ extras: [{ kind: "pet", id: 6, lv: 1 }] }, { ...lookup, pets }).t, {});
});

test("the same set piece in two slots counts once", () => {
  const items2 = new Map([[21, { id: 21, q: 4, sets: [9], fx: [] }], [22, { id: 22, q: 4, sets: [9], fx: [] }]]);
  const sets = { 9: { name: "Pair", pieces: [21, 22], effects: [{ num: 2, q: 0, desc: "ATK +10", fx: [["atk", 10]] }] } };
  const lk = { ...lookup, items: items2, sets };
  assert.equal(setBonuses({ acc1: { item: 21 }, acc2: { item: 21 } }, lk)[0]?.active.length, 0);
  assert.equal(setBonuses({ acc1: { item: 21 }, acc2: { item: 22 } }, lk)[0]?.active.length, 1);
});
