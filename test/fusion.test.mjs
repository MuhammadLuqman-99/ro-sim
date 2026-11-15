import { test } from "node:test";
import assert from "node:assert/strict";
import { mainChance, outcomes, problems, resultLines, targetChance, slotsOf } from "../web/lib/fusion.js";

const data = {
  fixed: {
    "fixed:1": { lines: { 1: ["ATK +10"], 2: ["ATK +7.5"], 3: ["ATK +6"] }, decay: 2001 },
    "fixed:2": { lines: { 1: ["HP +100"], 2: ["HP +75"], 3: ["HP +60"] }, decay: 2001 },
  },
  random: {
    g: { text: "CRIT +3", w: 40000 },   // green
    b: { text: "ATK +5", w: 20000 },    // blue
    p: { text: "PDMG +1%", w: 10000 },  // purple
    p2: { text: "PDMG +1%", w: 10000 }, // same text, other key
  },
};
const card = (id, q, extra = {}) => ({ id, q, slot: "Weapon", mvp: false, affixes: 2, fixed: `fixed:${id}`, ...extra });

test("same tier is 50/50, lower tier is favoured by weight", () => {
  assert.equal(mainChance(data, "b", "b", 1), 1); // identical effect
  assert.equal(mainChance(data, "g", "g", 1), 1);
  assert.equal(mainChance(data, "p", "b", 1), 10000 / 30000);
  assert.equal(mainChance(data, "g", "p", 1), 0.8);
  assert.equal(mainChance(data, "fixed:1", "fixed:2", 0), 0.5);
});

test("same text counts as the same effect", () => {
  assert.equal(mainChance(data, "p", "p2", 2), 1);
});

test("a lock forces that position", () => {
  assert.equal(mainChance(data, "g", "p", 1, { side: "mat", pos: 1 }), 0);
  assert.equal(mainChance(data, "g", "p", 1, { side: "main", pos: 1 }), 1);
});

test("outcomes cover every result and add up to 1", () => {
  const outs = outcomes(data, ["fixed:1", "g", "b"], ["fixed:2", "p", "b"]);
  assert.equal(outs.length, 4); // position 2 is identical
  assert.ok(Math.abs(outs.reduce((s, o) => s + o.p, 0) - 1) < 1e-12);
  assert.ok(Math.abs(targetChance(data, outs, "p") - 0.2) < 1e-12);
  assert.ok(Math.abs(targetChance(data, outs, "fixed:2") - 0.5) < 1e-12);
});

test("two fixed effects on one card shrink to 75%", () => {
  assert.deepEqual(resultLines(data, ["fixed:1", "fixed:2", "g"]), [["ATK +7.5"], ["HP +75"], ["CRIT +3"]]);
  assert.deepEqual(resultLines(data, ["fixed:1", "g", "b"]), [["ATK +10"], ["CRIT +3"], ["ATK +5"]]);
});

test("rules: slot, MVP, quality gap, lock needs equal quality", () => {
  assert.deepEqual(problems(card(1, 4), card(2, 3)), []);
  assert.equal(problems(card(1, 4), card(2, 2)).length, 1);
  assert.equal(problems(card(1, 3), card(2, 4)).length, 1);
  assert.equal(problems(card(1, 4), card(2, 4, { slot: "Armor" })).length, 1);
  assert.equal(problems(card(1, 4), card(2, 4, { mvp: true })).length, 1);
  assert.equal(problems(card(1, 4), card(2, 3), { side: "main", pos: 1 }).length, 1);
});

test("a card's positions are its fixed effect then its affixes", () => {
  assert.deepEqual(slotsOf(card(1, 4), ["g", "b"]), ["fixed:1", "g", "b"]);
  assert.deepEqual(slotsOf(card(1, 4, { affixes: 1 }), ["g", "b"]), ["fixed:1", "g"]);
});

test("the target is matched by text, so either card's copy of a shared effect works", () => {
  const outs = outcomes(data, ["fixed:1", "p", "g"], ["fixed:2", "p2", "b"]);
  assert.equal(targetChance(data, outs, "p"), 1);
  assert.equal(targetChance(data, outs, "p2"), 1);
});

test("a fixed effect carried in an affix position makes both fixed effects decay", () => {
  const outs = outcomes(data, ["fixed:1", "fixed:2", "g"], ["fixed:1", "fixed:2", "g"]);
  assert.equal(outs.length, 1);
  assert.deepEqual(resultLines(data, outs[0].keys), [["ATK +7.5"], ["HP +75"], ["CRIT +3"]]);
});
