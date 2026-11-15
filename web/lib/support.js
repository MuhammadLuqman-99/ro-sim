// Support tab maths: heals read from the skill text, the passives that change
// them, and what a party buff is worth to the friend who gets it.
// Pure functions over support.json; nothing here touches the page.
//
// Heal = (skill% × M.ATK (or ATK) + flat) × (1 + Healing% + heal passives)
//        × cuts (Purgatorial Angel) × (1 + target's Received Healing%)
// The game does not publish how these stack; adding the Healing% bonuses
// together and multiplying the rest is the usual Ragnarok mobile rule.

export function levelOf(sk, lv) {
  const n = sk.levels.length;
  return sk.levels[Math.max(1, Math.min(n, Number(lv) || 1)) - 1];
}

export function defaultLevel(sk) {
  return Math.min(sk.levels.length, sk.natural || sk.levels.length);
}

// The skill text at a level (support.json keeps one template per skill).
export function descOf(sk, lv) {
  const L = levelOf(sk, lv);
  return sk.t ? sk.t.replace(/\{(\d+)\}/g, (_, i) => L.n?.[Number(i)] ?? "") : (L.desc || "");
}

// The jobs from this one up to Novice, e.g. High Priest → Priest → Acolyte.
export function chainOf(jobs, jobId) {
  const out = [];
  let j = jobId ? String(jobId) : null;
  while (j && jobs[j] && !out.includes(j)) {
    out.push(j);
    j = jobs[j].parent ? String(jobs[j].parent) : null;
  }
  return out;
}

// Healing bonuses that reach one skill. mods: the passive levels that are on,
// as [{ add?, mult?, skills: null | [names] }].
export function healMods(skillName, mods) {
  let add = 0, mult = 1;
  for (const m of mods || []) {
    if (!m || (m.skills && !m.skills.includes(skillName))) continue;
    if (m.add) add += m.add;
    if (m.mult != null) mult *= m.mult;
  }
  return { add, mult };
}

// HP restored by one heal hit.
//   me: { matk, atk, heal }   target: { maxhp, rheal }   (heal/rheal as fractions)
export function healHit(part, me, target, mods = { add: 0, mult: 1 }) {
  const base = part.stat === "maxhp"
    ? (Number(target?.maxhp) || 0) * part.pct / 100
    : (Number(me?.[part.stat]) || 0) * part.pct / 100 + (part.flat || 0);
  return Math.max(0, base * (1 + (Number(me?.heal) || 0) + mods.add) * mods.mult * (1 + (Number(target?.rheal) || 0)));
}

// Every heal of a skill at a level, with:
//   hit     HP per hit (or per tick)
//   cast    HP from one cast (all ticks), null when it lasts as long as an aura
//   perSec  HP per second while it runs (ticks), or by spamming it off cooldown
//   avg     HP per second over the whole cooldown, when that is known
export function healSkill(sk, lv, me, target, mods) {
  const L = levelOf(sk, lv);
  const cd = Number(L.cd) || 0;
  return (L.heal || []).map((p) => {
    const hit = healHit(p, me, target, mods);
    if (p.every) {
      const ticks = p.dur && p.dur <= 60 ? Math.floor(p.dur / p.every + 1e-9) : null;
      const cast = ticks ? hit * ticks : null;
      return { ...p, hit, ticks, cast, perSec: hit / p.every, avg: cast && cd ? cast / Math.max(cd, p.dur) : null };
    }
    return { ...p, hit, ticks: 1, cast: hit, perSec: cd ? hit / cd : null, avg: cd ? hit / cd : null };
  });
}

// Your own buffs on your own M.ATK / ATK (they say "for you and your teammates").
export function withBuffs(me, fx) {
  let atk = 0, matk = 0, atkall = 0, matkall = 0;
  for (const [k, v] of fx || []) {
    if (k === "atk") atk += v;
    if (k === "matk") matk += v;
    if (k === "atkall") atkall += v;
    if (k === "matkall") matkall += v;
  }
  return {
    ...me,
    atk: ((Number(me.atk) || 0) + atk) * (1 + atkall),
    matk: ((Number(me.matk) || 0) + matk) * (1 + matkall),
  };
}

// How much harder a friend hits with these buffs, as a fraction (0.12 = +12%).
// Only ATK, ATK% and damage bonuses turn into a number; stats like STR or
// CRIT are listed by the page instead. null when the friend's ATK is unknown.
//   friend: { magic: bool, atk }   (atk = the friend's ATK, or M.ATK for magic)
export function buffGain(fx, friend) {
  const base = Number(friend?.atk) || 0;
  if (base <= 0) return null;
  const magic = Boolean(friend.magic);
  let flat = 0, all = 0, dmg = 0, mult = 0;
  for (const [k, v] of fx || []) {
    if (k === (magic ? "matk" : "atk")) flat += v;
    if (k === (magic ? "matkall" : "atkall")) all += v;
    if (k === (magic ? "mdmg" : "pdmg")) dmg += v;
    if (k === "mult") mult += v;
  }
  return ((base + flat) * (1 + all) / base) * (1 + dmg) * (1 + mult) - 1;
}

// The keys buffGain turns into damage, for the page to tell counted from listed.
export function gainKeys(magic) {
  return new Set(magic ? ["matk", "matkall", "mdmg", "mult"] : ["atk", "atkall", "pdmg", "mult"]);
}
