import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStats } from "../web/lib/statscan.js";

const get = (rows, k) => rows.find((r) => r.key === k)?.value;

test("reads flat and percent stats, with thousands separators", () => {
  const rows = parseStats("P.ATK 2,345\nM.ATK 1,880\nP.DMG Bonus 18.5%\nCRIT DMG 52%");
  assert.equal(get(rows, "atk"), 2345);
  assert.equal(get(rows, "matk"), 1880);
  assert.ok(Math.abs(get(rows, "pdmg") - 0.185) < 1e-12);
  assert.ok(Math.abs(get(rows, "critdmg") - 0.52) < 1e-12);
});

test("two stats on one line and base + bonus are both handled", () => {
  const rows = parseStats("ATK 150 + 45   DEF 30\nSTR 90 + 12  AGI 40");
  assert.equal(get(rows, "atk"), 195);
  assert.equal(get(rows, "def"), 30);
  assert.equal(get(rows, "str"), 102);
  assert.equal(get(rows, "agi"), 40);
});

test("specific labels win over general ones", () => {
  const rows = parseStats("P.DMG Reduction 12%\nP.DMG Bonus 9%\nCRIT RES 20\nCRIT 35\nCRIT DMG RES 5%");
  assert.ok(Math.abs(get(rows, "pred") - 0.12) < 1e-12);
  assert.ok(Math.abs(get(rows, "pdmg") - 0.09) < 1e-12);
  assert.equal(get(rows, "critres"), 20);
  assert.equal(get(rows, "crit"), 35);
  assert.ok(Math.abs(get(rows, "critdmgres") - 0.05) < 1e-12);
});

test("race, size and element bonuses map to the damage keys", () => {
  const rows = parseStats("DMG vs Demi-Human 6%\nDMG vs Large 4%\nWater DMG 10%\nFire DMG Reduction 3%");
  assert.ok(Math.abs(get(rows, "race:Demi-Human") - 0.06) < 1e-12);
  assert.ok(Math.abs(get(rows, "size:Large") - 0.04) < 1e-12);
  assert.ok(Math.abs(get(rows, "elem:Water") - 0.1) < 1e-12);
  assert.equal(get(rows, "elem:Fire"), undefined);
});

test("noise lines and labels without numbers are ignored", () => {
  const rows = parseStats("Character Info\nATK\n~~ ## ~~\nLv. 85 Lord Knight");
  assert.equal(rows.length, 0);
});

test("the first value of a stat wins if OCR repeats it", () => {
  const rows = parseStats("ATK 1000\nATK 9");
  assert.equal(get(rows, "atk"), 1000);
});

test("Healing and Received Healing are told apart", () => {
  const rows = parseStats("Healing 12%\nReceived Healing 5%\nMax HP 45,000");
  assert.ok(Math.abs(get(rows, "heal") - 0.12) < 1e-12);
  assert.ok(Math.abs(get(rows, "rheal") - 0.05) < 1e-12);
  assert.equal(get(rows, "hp"), 45000);
  const flipped = parseStats("Healing Received 7%");
  assert.ok(Math.abs(get(flipped, "rheal") - 0.07) < 1e-12);
  assert.equal(get(flipped, "heal"), undefined);
});

test("reductions are not read as damage bonuses", () => {
  const rows = parseStats("Ranged PDMG Reduction 12%\nMelee P.DMG Reduction 3%\nCRIT DMG Reduction 7%\nRanged M.DMG Reduction 2%\nRanged P.DMG 9%");
  assert.ok(Math.abs(get(rows, "rpred") - 0.12) < 1e-12);
  assert.ok(Math.abs(get(rows, "mpred") - 0.03) < 1e-12);
  assert.ok(Math.abs(get(rows, "critdmgres") - 0.07) < 1e-12);
  assert.ok(Math.abs(get(rows, "rmred") - 0.02) < 1e-12);
  assert.ok(Math.abs(get(rows, "ranged") - 0.09) < 1e-12);
  assert.equal(get(rows, "melee"), undefined);
  assert.equal(get(rows, "critdmg"), undefined);
});

test("Mech is a race the reader knows", () => {
  assert.ok(Math.abs(get(parseStats("DMG vs Mech 5%"), "race:Mech") - 0.05) < 1e-12);
});
