import { test } from "node:test";
import assert from "node:assert/strict";
import { statOf, titleCore, parseTip, readGear, matchCard } from "../web/lib/gearscan.js";
import { TIPS } from "./fixtures/gear-tips.mjs";

// A small cut of the game data: enough look-alikes to make matching earn its answer.
const item = (id, n, at, lv, q, fx = [], jobs = null) => ({ id, n, at, lv, q, fx, rfx: [], jobs });
const items = [
  item(1, "Royal Falcon Muffler III", 7, 91, 6, [["hp", 6000]]), item(2, "Royal Falcon Muffler II", 7, 81, 6), item(3, "Falcon Muffler III", 7, 91, 5),
  item(4, "Royal Captain's Manteau III", 7, 91, 6),
  item(10, "Rogue's Treasure III", 9, 90, 4, [["hp", 1200]]), item(11, "Rogue's Treasure III", 9, 90, 5, [["hp", 1500]]), item(12, "Royal Rogue's Treasure III", 9, 90, 6),
  item(13, "Cold Heart III", 9, 90, 5, [["atk", 50], ["hp", 1784]]), item(14, "Royal Cold Heart III", 9, 90, 6, [["atk", 70]]), item(15, "Cold Heart II", 9, 80, 5),
  item(20, "Royal Vecer Axe III", 5, 90, 6, [["atk", 250]]), item(21, "Royal Windhawk III", 5, 90, 6, [["atk", 250]]), item(22, "Royal Orcish Axe V", 5, 90, 6, [["atk", 250]]),
  item(30, "Altered Shadow Hunt Earring I", 25, 75, 5, [["hp", 1203], ["atk", 29]]), item(31, "Royal Altered Shadow Hunt Earring I", 25, 75, 6, [["hp", 1795], ["atk", 44]]),
  item(32, "Altered Shadow Hunt Shield I", 22, 75, 5, [["def", 28], ["mdef", 4]]), item(33, "Royal Altered Shadow Hunt Shield I", 22, 75, 6, [["def", 42], ["mdef", 6]]),
  item(34, "Royal Altered Shadow Hunt Pendant I", 26, 75, 6, [["hp", 1795], ["atk", 44]]),
  item(40, "Angel Wing", 1, 1, 5, [["atk", 30], ["matk", 30]]), item(41, "Beard", 3, 1, 4), item(42, "Pharaoh Beard", 3, 1, 5),
];
const card = (id, name, slot, fx) => ({ id, name, slot, fx, other: [] });
const cards = [
  card(100, "Skeleton Worker Card", "Weapon", [["size:Medium", 0.09, 0.15]]), card(101, "Hydra Card", "Weapon", [["race:Demi-Human", 0.12, 0.2]]),
  card(102, "Orc Archer Card", "Accessory", [["ranged", 0.03, 0.05]]), card(103, "Vagabond Wolf Card", "Cape", [["str", 2, 4]]),
  card(104, "Hornet Card", "Headwear", [["atk", 9, 15]]), card(105, "Giant Hornet Card", "Backwear", []), card(106, "Diligent Deniro Card", "Mouthwear", [["str", 3, 5]]),
];
const data = { items, cards };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const extra = (g, key, tag) => g.extras.filter((x) => x.key === key && (!tag || x.label.includes(tag)));

test("a stat line is read whatever OCR does to its bullet and its % sign", () => {
  assert.deepEqual(statOf("DMG vs Human%+2.11%"), { key: "race:Demi-Human", value: 0.0211 });
  assert.deepEqual(statOf("QD OMG vs Human®+2.11%"), { key: "race:Demi-Human", value: 0.0211 });
  assert.deepEqual(statOf("DMG vs Brute’i+ 1.97%"), { key: "race:Brute", value: 0.0197 });
  assert.deepEqual(statOf("SFire DMG%+ 1.64%"), { key: "elem:Fire", value: 0.0164 });
  assert.deepEqual(statOf("4» DMG vs Shadow? +2.65%"), { key: "vselem:Shadow", value: 0.0265 });
  assert.deepEqual(statOf("+ DMG vs Medium? +15.08%"), { key: "size:Medium", value: 0.1508 });
  assert.deepEqual(statOf("Neutral DMGY%+3.25%"), { key: "elem:Neutral", value: 0.0325 });
  assert.deepEqual(statOf("STR+8 WW"), { key: "str", value: 8 });
  assert.deepEqual(statOf("Fixed Bonus DMG+10"), { key: "fixall", value: 10 });
});

test("a % sign that OCR set apart with a space still makes it a percent", () => {
  assert.deepEqual(statOf("ATK +2 %"), { key: "atkp", value: 0.02 });
  assert.deepEqual(statOf("HP +3 %"), { key: "hpp", value: 0.03 });
  assert.deepEqual(statOf("ATK +15 Ld"), { key: "atk", value: 15 });
});

test("two of the same gem on one piece count twice; the same gem in two screenshots counts once", () => {
  const top = "Angel Wing+12 8)\nHeadwear - C\nOverall Ratin\nLv.:1 2:1\n* Base Stats:\nATK +30\n+ Enchant Stone Stats:\n@ Domineering GemLv.2:ATK%+2%\n@ Domineering GemLv.2:ATK%+2%\n@ STR GemLv.3:STR+3";
  const lower = "Angel Wing+12 8)\nOverall Ratin\nLv.:1 2:1\n@ Domineering GemLv.2:ATK%+2%\n@ STR GemLv.3:STR+3\n* Frenzy lll Lv. 1:\nATK+10";
  const g = readGear([top, lower], data).gear[0];
  assert.equal(extra(g, "atkp", "gem").length, 2);
  assert.equal(extra(g, "str", "gem").length, 1);
  assert.equal(extra(g, "atk", "Frenzy III").length, 1);
});

test("an accessory read later goes to the empty accessory slot, or back to its own", () => {
  const shots = [TIPS.acc2tip, TIPS.acc2b, TIPS.acc2d]; // Cold Heart III (item 13)
  assert.equal(readGear(shots, data).gear[0].slot, "acc1");
  assert.equal(readGear(shots, data, null, { acc1: 11, acc2: null }).gear[0].slot, "acc2"); // Accessory 1 holds another ring
  assert.equal(readGear(shots, data, null, { acc1: 11, acc2: 13 }).gear[0].slot, "acc2"); // read again: back to where it is
  assert.equal(readGear(shots, data, null, { acc1: 13, acc2: 11 }).gear[0].slot, "acc1");
});

test("a piece with no slot to go to is counted, not silently dropped", () => {
  const out = readGear(["Mystery Thing\nOverall Rating\nLv.:50\n* Base Stats:\nATK +5"], data);
  assert.equal(out.gear.length, 0);
  assert.equal(out.unplaced, 1);
});

test("ATK and ATK% are told apart, and so are Undead the race and Undead the element", () => {
  assert.deepEqual(statOf("ATK+15"), { key: "atk", value: 15 });
  assert.deepEqual(statOf("ATK%+5.50%"), { key: "atkp", value: 0.055 });
  assert.deepEqual(statOf("ATK +1.4%"), { key: "atkp", value: 0.014 });
  assert.deepEqual(statOf("DMG vs Undead Race®+2.49%"), { key: "race:Undead", value: 0.0249 });
  assert.deepEqual(statOf("DMG vs Undead Element% +1.20%"), { key: "vselem:Undead", value: 0.012 });
});

test("lines the Damage tab has no stat for give nothing", () => {
  for (const l of ["Water DMG Reduction% +1.80%", "CRIT DMG RES%+1%", "Refine ATK+139", "DMG vs Archer%+6.41%", "Sleep RES +15",
    "Throwing Skill DMG multiplier +14%", "increased by 15%", "Ignore P.DEF%+1%", "Base Gear%+51%", "Aggressive+125"]) assert.equal(statOf(l), null, l);
});

test("the item's name is what is left of a scrolling title", () => {
  assert.equal(titleCore("se)Royal Berdysz III: [5]"), "Royal Berdysz III");
  assert.equal(titleCore("(Apocalypse)Royal F"), "Royal"); // a lone letter at the cut edge is dropped: half of it is hidden
  assert.equal(titleCore("icalypse)Royal Berd:"), "Royal Berd");
  assert.equal(titleCore("gue's Treasure lli+1. a"), "gue's Treasure lli");
  assert.equal(titleCore("Lamor Shield IV+13 3)"), "Lamor Shield IV");
  assert.equal(titleCore("Beard+11 3)"), "Beard"); // the ")" of a stray mark is not the end of "(Apocalypse)"
  assert.equal(titleCore("Altered Shadow Hur fe)"), "Altered Shadow Hur");
});

test("one screenshot: slot, level and the refine badge", () => {
  const tip = parseTip(TIPS.wtip2);
  assert.equal(tip.slotWord, "Weapon");
  assert.equal(tip.sub, "1H Axe");
  assert.equal(tip.lv, 90);
  assert.equal(tip.refine, 16);
  assert.ok(tip.royal);
  assert.deepEqual(tip.sections.map((s) => s.kind), ["above", "trait", "refine", "enhance"]);
});

test("\"Refine Lv.\" inside a skill's text is not the refine level", () => {
  const tip = parseTip(TIPS.weapontip); // Thor's Edge: "(Gear Refine Lv. x Refine Lv.), up to Lv. 15"
  assert.equal(tip.refine, null);
  assert.deepEqual(tip.sections.map((s) => s.kind), ["above", "base", "special"]);
});

test("the gear list and the Enhance panel are not tooltips", () => {
  assert.equal(parseTip(TIPS.gearlist2), null);
  assert.equal(parseTip(TIPS.enhance_panel), null);
  assert.equal(parseTip("Character Info\nLv. 85 Lord Knight"), null);
});

test("four screenshots of one weapon make one entry, with nothing counted twice", () => {
  const { gear, read } = readGear([TIPS.weapontip, TIPS.wtip2, TIPS.enhance_panel, TIPS.wtip_end, TIPS.wtip_end2], data);
  assert.equal(read, 4);
  assert.equal(gear.length, 1);
  const g = gear[0];
  assert.equal(g.slot, "weapon");
  assert.equal(g.item, null); // "Royal Berdysz III" is not in the data: no look-alike is picked
  assert.equal(g.read, "Royal Berdysz III");
  assert.equal(g.refine, 16);
  assert.deepEqual(g.shots, [0, 1, 3, 4]);
  assert.equal(g.card.id, 100);
  assert.deepEqual(g.cards, ["Skeleton Worker Card", "Hydra Card"]);
  // the card in the slot's pick counts its own main line; its extra lines and the second card come as exact numbers
  assert.equal(extra(g, "size:Medium").length, 0);
  assert.ok(near(extra(g, "vselem:Shadow", "Skeleton Worker affix")[0].value, 0.0265));
  assert.ok(near(extra(g, "race:Demi-Human", "Hydra #2")[0].value, 0.1669));
  assert.equal(extra(g, "race:Demi-Human", "Hydra").length, 1); // two screenshots show the Hydra card
  assert.ok(near(extra(g, "ranged", "trait")[0].value, 0.0234));
  assert.ok(near(extra(g, "atkp", "gem")[0].value, 0.02));
  assert.deepEqual(extra(g, "str").map((x) => [x.label, x.value]), [["Weapon · gem", 3], ["Weapon · Swift Attack II", 2]]);
  assert.ok(g.skipped.some((x) => /Limit Throw.*increased by 15/.test(x.line)));
});

test("a title that scrolls across four screenshots still names one cape", () => {
  const { gear } = readGear([TIPS.capetip, TIPS.cape2, TIPS.cape3, TIPS.cape4], data);
  assert.equal(gear.length, 1);
  assert.equal(gear[0].slot, "cape");
  assert.equal(gear[0].item.id, 1); // not the II (level 81), not the non-Royal one, not the other Royal cape
  assert.ok(gear[0].sure);
  assert.equal(gear[0].refine, 12);
  assert.deepEqual(gear[0].cards, ["Vagabond Wolf Card", "Vagabond Wolf Card"]); // two of the same card are two cards
  assert.equal(gear[0].card.id, 103);
});

test("two accessories fill Accessory 1 and 2; a title cut at \"+1\" is not refine 1", () => {
  const { gear } = readGear([TIPS.acc1b, TIPS.acc1c, TIPS.acc1d, TIPS.acc2tip, TIPS.acc2b, TIPS.acc2d], data);
  assert.deepEqual(gear.map((g) => [g.slot, g.name, g.refine]), [["acc1", "Rogue's Treasure III", 16], ["acc2", "Cold Heart III", 15]]);
  assert.equal(gear[0].sure, false); // the same name in two qualities and no base stats on screen: flagged for a look
  assert.equal(gear[1].item.id, 13); // base stats on screen (ATK +50, HP +1784) pick the quality
  assert.ok(gear[1].sure);
  assert.deepEqual(gear[1].cards, ["Orc Archer Card", "Orc Archer Card"]);
  assert.equal(extra(gear[1], "ranged", "Orc Archer #2").length, 1);
  assert.equal(extra(gear[1], "ranged", "Orc Archer affix").length, 0);
});

test("shadow gear with the same cut title is split by its base stats", () => {
  const { gear } = readGear([TIPS.sg_earring, TIPS.sg_shield], data);
  assert.deepEqual(gear.map((g) => [g.slot, g.item.id]), [["sh_earring", 31], ["sh_shield", 32]]);
  assert.ok(near(extra(gear[0], "elem:Holy", "affix")[0].value, 0.0374));
  assert.equal(gear[0].refine, null);
  assert.ok(gear[0].skipped.some((x) => /Archer/.test(x.line))); // class damage: read, not counted, said so
  assert.equal(gear[1].skipped.length, 0); // a shield's reduction lines are not damage: nothing to say
});

test("amplification steps printed on every shadow piece do not make two pieces one", () => {
  // as the browser read them: gloves with their slot word, then a shield whose slot line was unreadable
  const gloves = "Shadow Hunt Glove:\nGloves Royal » @\nOverall Ratin® wD\nLv.:75 eS:\n* Base Stats:\nATK +132 (+50.0%)\nAt Amplification Lv. +10, Ranged\nPhysical DMG +2%\nAt Amplification Lv. +25, ATK% +3%\n+ Affix Stats:\n+STR+8 WW";
  const shield = "Altered Shadow Hur fe)\n5 iy\nOverall Ratind® ~5\nLv.:75 2:1\n* Base Stats:\nDEF +28 (+20.0%)\nM.DEF +4 (+20.0%)\nAt Amplification Lv. +10, Elemental\nDMG Reduction +2%\nAt Amplification Lv. +25, for every 20\n* Affix Stats:\n+ Water DMG Reduction%+2.74%";
  const more = [...items, { id: 60, n: "Royal Shadow Hunt Gloves I", at: 23, lv: 75, q: 6, fx: [["atk", 132]], rfx: [], jobs: null }];
  const { gear } = readGear([gloves, shield], { items: more, cards });
  assert.deepEqual(gear.map((g) => [g.slot, g.item.id]), [["sh_gloves", 60], ["sh_shield", 32]]);
  assert.equal(extra(gear[0], "str", "affix")[0].value, 8);
});

test("top halves shot first and bottom halves later are joined by name", () => {
  const { gear } = readGear([TIPS.hw_head, TIPS.hw_mouth, TIPS.hw_head2, TIPS.hw_mouth2], data);
  assert.deepEqual(gear.map((g) => [g.slot, g.name, g.refine, g.shots]), [["head", "Angel Wing", 12, [0, 2]], ["mouth", "Beard", 11, [1, 3]]]);
  assert.deepEqual(gear[0].cards, ["Hornet Card", "Hornet Card"]);
  assert.equal(gear[1].card.id, 106);
  assert.ok(near(extra(gear[0], "pdmg", "gem")[0].value, 0.01)); // "Battle Will GemLv.1:PDMG" / "Bonus%+1%" on two lines
  assert.equal(extra(gear[0], "fixall", "gem")[0].value, 10);
});

test("the picked job narrows items that differ only by job", () => {
  const twins = [item(50, "Shadow Hunt Gloves I (Flick)", 23, 75, 5, [["atk", 90]], [723]), item(51, "Shadow Hunt Gloves I (Sniper)", 23, 75, 5, [["atk", 90]], [413])];
  const text = "Shadow Hunt Glove:\nGloves\nOverall Rating\nLv.:75\n* Base Stats:\nATK +90 (+50.0%)\n* Affix Stats:\n+STR+8";
  assert.equal(readGear([text], { items: twins, cards }).gear[0].sure, false);
  const picked = readGear([text], { items: twins, cards }, 413).gear[0];
  assert.equal(picked.item.id, 51);
  assert.ok(picked.sure);
});

test("a card name with a misread bullet in front still matches", () => {
  assert.equal(matchCard("OHydra", cards, "Weapon").id, 101);
  assert.equal(matchCard("pskeleton Worker", cards, "Weapon").id, 100);
  assert.equal(matchCard("Giant Hornet", cards).id, 105); // not the shorter "Hornet"
  assert.equal(matchCard("Hornet", cards, "Headwear").id, 104);
  assert.equal(matchCard("Ogretooth", cards), null);
});
