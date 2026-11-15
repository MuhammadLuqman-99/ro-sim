import { test } from "node:test";
import assert from "node:assert/strict";
import { buffGain, chainOf, descOf, healHit, healMods, healSkill, withBuffs } from "../web/lib/support.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ""} ${a} vs ${b}`);

const heal = { name: "Heal", t: "Heals for {0}%*M.ATK + {1} HP.", natural: 2,
  levels: [{ cd: 1, n: ["400", "200"], heal: [{ pct: 400, flat: 200, stat: "matk" }] },
    { cd: 1, n: ["450", "235"], heal: [{ pct: 450, flat: 235, stat: "matk" }] }] };
const sanctuary = { name: "Sanctuary", levels: [{ cd: 12, desc: "x", heal: [{ pct: 100, flat: 1200, stat: "matk", every: 1, dur: 8 }] }] };
const aura = { name: "Apple", levels: [{ cd: 12, desc: "x", heal: [{ pct: 400, flat: 200, stat: "atk" }, { pct: 200, flat: 100, stat: "atk", every: 2, dur: 600, aura: true }] }] };

test("the skill text is rebuilt from its template at each level", () => {
  assert.equal(descOf(heal, 1), "Heals for 400%*M.ATK + 200 HP.");
  assert.equal(descOf(heal, 2), "Heals for 450%*M.ATK + 235 HP.");
  assert.equal(descOf(heal, 99), "Heals for 450%*M.ATK + 235 HP."); // clamped
});

test("a heal is skill% × M.ATK + flat, then Healing%, then the target's Received Healing%", () => {
  const me = { matk: 2000, heal: 0.1 };
  near(healHit(heal.levels[1].heal[0], me, {}), (4.5 * 2000 + 235) * 1.1);
  near(healHit(heal.levels[1].heal[0], me, { rheal: 0.05 }), (4.5 * 2000 + 235) * 1.1 * 1.05);
});

test("Max HP heals use the target's Max HP", () => {
  near(healHit({ pct: 59.7, flat: 0, stat: "maxhp" }, {}, { maxhp: 50000 }), 29850);
});

test("heal passives add to Healing%, cuts multiply, and only reach the skills they name", () => {
  const mods = [{ skills: null, add: 0.11 }, { skills: ["Coluseo Heal"], add: 0.3 }, { skills: ["Heal", "Sanctuary"], mult: 0.2 }];
  assert.deepEqual(healMods("Coluseo Heal", mods), { add: 0.41, mult: 1 });
  const h = healMods("Heal", mods);
  near(h.add, 0.11); near(h.mult, 0.2);
});

test("ticking heals give per tick, per cast and the average over the cooldown", () => {
  const [p] = healSkill(sanctuary, 1, { matk: 1000 }, {});
  near(p.hit, 2200);
  assert.equal(p.ticks, 8);
  near(p.cast, 17600);
  near(p.perSec, 2200);
  near(p.avg, 17600 / 12);
});

test("an aura that lasts minutes has no per-cast total", () => {
  const [burst, au] = healSkill(aura, 1, { atk: 1000 }, {});
  near(burst.cast, 4200);
  near(burst.avg, 4200 / 12);
  assert.equal(au.cast, null);
  near(au.perSec, 2100 / 2);
});

test("your own buffs raise the M.ATK your heals use", () => {
  const me = withBuffs({ matk: 1000, heal: 0.1 }, [["matk", 60], ["matkall", 0.12], ["str", 30]]);
  near(me.matk, 1060 * 1.12);
  assert.equal(me.heal, 0.1);
});

test("a buff's worth to a friend: flat ATK, then ATK%, then damage bonuses", () => {
  near(buffGain([["atk", 60], ["matk", 60]], { magic: false, atk: 3000 }), 3060 / 3000 - 1);
  near(buffGain([["atkall", 0.12], ["matkall", 0.12]], { magic: true, atk: 2000 }), 0.12);
  near(buffGain([["atk", 60], ["atkall", 0.12]], { magic: false, atk: 3000 }), (3060 * 1.12) / 3000 - 1);
  assert.equal(buffGain([["str", 30]], { magic: false, atk: 3000 }), 0);
  assert.equal(buffGain([["atk", 60]], { magic: false }), null);
});

test("the job chain walks up to the base job", () => {
  const jobs = { 101: { parent: 0 }, 501: { parent: 101 }, 512: { parent: 501 }, 513: { parent: 512 } };
  assert.deepEqual(chainOf(jobs, "513"), ["513", "512", "501", "101"]);
  assert.deepEqual(chainOf(jobs, ""), []);
});
