// Read gear out of OCR text from the game's gear tooltip (the card that opens
// when you tap a piece of gear). Pure functions: text in, plain objects out.
//
// One tooltip does not fit one screen: its title scrolls sideways like a
// ticker ("(Apocalypse)Royal F", "e)Royal Falcon Muff", "oyal Falcon Muffler I")
// and its body scrolls down. So several screenshots of the same piece are read
// one by one (parseTip), joined (groupTips) and only then matched to the game
// data by slot, level and every bit of the name that was seen (matchItem).

const RACES = ["Demi-Human", "Brute", "Demon", "Plant", "Undead", "Formless", "Fish", "Insect", "Angel", "Dragon", "Mech"];
const SIZES = ["Small", "Medium", "Large"];
const ELEMS = ["Neutral", "Water", "Earth", "Fire", "Wind", "Poison", "Holy", "Shadow", "Ghost", "Undead"];
const pick = (list, w) => list.find((x) => x.toLowerCase() === String(w).toLowerCase());

// The word the tooltip prints under the title -> which slot of the Damage tab.
// Shadow gear uses its own words (Earring, Pendant, Gloves, Shield) and shares
// "Armor" and "Shoes" with normal gear; `shadow` settles those two.
const SLOT_WORDS = [
  [/\bOff-?\s?H(?:and)?\b/i, "Off-Hand"], [/\bWeapon\b/i, "Weapon"], [/\bArmor\b/i, "Armor"], [/\bCape\b/i, "Cape"],
  [/\bShoes?\b/i, "Shoes"], [/\b(?:A\s?)?c{0,2}essory\b|\bAll Parts\b/i, "Accessory"], [/\bHeadwear\b/i, "Headwear"], [/\bFacewear\b/i, "Facewear"],
  [/\bMouthwear\b/i, "Mouthwear"], [/\bBackwear\b/i, "Backwear"], [/\bEarrin/i, "Earring"], [/\bPendan/i, "Pendant"],
  [/\bGloves?\b/i, "Gloves"], [/\bShield\b/i, "Shield"],
];
const SLOT_OF = {
  Weapon: ["weapon"], "Off-Hand": ["offhand"], Armor: ["armor"], Cape: ["cape"], Shoes: ["shoes"], Accessory: ["acc1", "acc2"],
  Headwear: ["head"], Facewear: ["face"], Mouthwear: ["mouth"], Backwear: ["back"],
};
const SHADOW_SLOT_OF = { Armor: "sh_armor", Shield: "sh_shield", Gloves: "sh_gloves", Shoes: "sh_shoes", Earring: "sh_earring", Pendant: "sh_pendant" };
// slot id -> the data's assembly type (items[].at) and card slot name
const SLOT_AT = { weapon: 5, offhand: 6, armor: 4, cape: 7, shoes: 8, acc1: 9, acc2: 9, head: 1, face: 2, mouth: 3, back: 12,
  sh_armor: 21, sh_shield: 22, sh_gloves: 23, sh_shoes: 24, sh_earring: 25, sh_pendant: 26 };
const SLOT_CARD = { weapon: "Weapon", offhand: "Off-Hand", armor: "Armor", cape: "Cape", shoes: "Shoes", acc1: "Accessory", acc2: "Accessory",
  head: "Headwear", face: "Facewear", mouth: "Mouthwear", back: "Backwear" };
const SLOT_LABEL = { weapon: "Weapon", offhand: "Off-Hand", armor: "Armor", cape: "Cape", shoes: "Shoes", acc1: "Accessory 1", acc2: "Accessory 2",
  head: "Headwear", face: "Facewear", mouth: "Mouthwear", back: "Backwear", sh_armor: "Shadow Armor", sh_shield: "Shadow Shield",
  sh_gloves: "Shadow Gloves", sh_shoes: "Shadow Shoes", sh_earring: "Shadow Earring", sh_pendant: "Shadow Pendant" };

// ---- names -----------------------------------------------------------------
// OCR cannot tell I, l, 1 and | apart ("III" comes back as "lll" or "Ill"), so
// they all become "i" on both sides before two names are compared.
export function norm(s) {
  return String(s || "").replace(/Ⅰ/g, "i").replace(/Ⅱ/g, "ii").replace(/Ⅲ/g, "iii").replace(/Ⅳ/g, "iv").replace(/Ⅴ/g, "v")
    .toLowerCase().replace(/[l1|!]/g, "i").replace(/[^a-z0-9]/g, "");
}
// The part of a title that names the item: no "(Apocalypse)" in front (or what
// is left of it), no "+16" behind, no stray symbols the lock icon turns into.
// what the lock icon and the card edge turn into at the end of a title: " [5]", " 3)", " fe)", " a" (a lone I, V or X is a numeral)
function stripMarks(title) {
  let t = String(title || "").trim();
  for (let i = 0; i < 2; i++) t = t.replace(/\s+(?:(?=\S{1,3}$)\S*[^A-Za-z0-9'+\s]\S*|[^IVX\s])$/, "");
  return t;
}
export function titleCore(raw) {
  let t = stripMarks(raw);
  // "(Apocalypse)" in front, or what is left of it as the title scrolls: "pse)", "icalypse)", "1)"
  const close = t.indexOf(")");
  if (close >= 0 && close < 14) {
    const letters = t.slice(0, close).replace(/[^A-Za-z]/g, "").toLowerCase();
    if (letters.length <= 2 || "apocalypse".endsWith(letters.slice(1))) t = t.slice(close + 1);
  }
  t = t.replace(/[+«»]\s*\d{0,2}\.?\s*$/, ""); // the refine level, whole or cut off
  return t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9']+$/g, "").trim();
}
// How many characters of the fragment sit inside the name. The first and last
// letter of a scrolling title are often half hidden and misread, so they may
// be dropped. 0 = no real match.
function fragmentScore(fragNorm, nameNorm) {
  if (fragNorm.length < 4) return 0;
  for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 0], [0, 2]]) {
    const f = fragNorm.slice(a, fragNorm.length - b);
    if (f.length >= 4 && nameNorm.includes(f)) return f.length;
  }
  return 0;
}

// ---- one stat line -----------------------------------------------------------
// "DMG vs Human%+2.11%", "Ranged PDMG% +4.20%", "ATK+15", "PDMG Bonus%+1%",
// "ATK +1.4%". Returns { key, value } with percents as fractions, or null for a
// line the Damage tab has no stat for (class damage, reductions, skill text).
const STAT_START = new RegExp(`(?:DMG (?:vs|to)\\b|(?:${ELEMS.join("|")}|[EF]lemental) DMG\\b|Fixed Bonus DMG\\b|(?:Ranged|Melee) [PM]\\.?\\s?DMG|[PM]\\.?\\s?DMG Bonus|Fixed [PM]\\.?\\s?DMG|CRIT\\b|ASPD\\b|M\\.?\\s?ATK\\b|P\\.?\\s?ATK\\b|ATK\\b|Max HP\\b|HP\\b|M\\.?\\s?DEF\\b|DEF\\b|STR\\b|AGI\\b|VIT\\b|INT\\b|DEX\\b|LUK\\b)`, "i");
export function statOf(rawLine) {
  let line = String(rawLine || "").replace(/[’‘`´]/g, "'").replace(/\s+/g, " ").trim();
  // the bullet in front of a line runs into its first letter: "0OMG vs", "QD OMG vs", "POMG"
  line = line.replace(/\b([PM])\.?[O0]MG\b/g, "$1DMG").replace(/(?:^|[^A-Za-z])[0OQD@ ]{0,3}[O0D]MG (vs|to)\b/i, " DMG $1")
    .replace(/DMG[Y¥](?=\s*[%+])/g, "DMG").replace(/(\d%?)\s+[^\s%]{1,2}$/, "$1"); // "DMGY%", and a stray mark after the number (never a "%")
  if (/Reduction|taken|\bRES\b|Ignore|Refine|Base Gear|Aggressive|Defensive|Amplification|multiplier|chance|Cooldown/i.test(line)) return null;
  const at = line.search(STAT_START);
  if (at < 0) return null;
  line = line.slice(at);
  const m = line.match(/^([A-Za-z][A-Za-z .\-/]*?)\s*((?:[%°'":;.?!*®©¥]|'i){0,3})\s*[+«»e:]?\s*(-?\d[\d,]*(?:\.\d+)?)\s*([%°'":;.,]*)\s*\W{0,3}$/);
  if (!m) return null;
  const name = m[1].replace(/\./g, "").replace(/\s+/g, " ").trim().toUpperCase();
  const value = Number(m[3].replace(/,/g, ""));
  if (!Number.isFinite(value) || value === 0) return null;
  const pctSign = /%/.test(m[2]) || /%/.test(m[4]) || (m[3].includes(".") && (m[2] !== "" || m[4] !== ""));
  const pct = (key) => ({ key, value: Number((value / 100).toFixed(6)) });
  let t;
  if ((t = name.match(/^DMG (?:VS|TO) (.+?)( RACE| ELEMENT)?$/))) {
    const who = t[1] === "HUMAN" ? "Demi-Human" : t[1], kind = (t[2] || "").trim();
    if (kind !== "ELEMENT" && pick(RACES, who) && !(kind === "" && pick(ELEMS, who))) return pct(`race:${pick(RACES, who)}`);
    if (kind !== "ELEMENT" && pick(SIZES, who)) return pct(`size:${pick(SIZES, who)}`);
    if (kind !== "RACE" && pick(ELEMS, who)) return pct(`vselem:${pick(ELEMS, who)}`);
    return null; // a class ("DMG vs Archer"), or plain "Undead" with nothing to say which
  }
  if ((t = name.match(/^([A-Z]+) DMG$/)) && pick(ELEMS, t[1])) return pct(`elem:${pick(ELEMS, t[1])}`);
  if (name === "ELEMENTAL DMG" || name === "FLEMENTAL DMG") return pct("elemall");
  if (name === "FIXED BONUS DMG") return { key: "fixall", value };
  if (/^RANGED P ?DMG( BONUS)?$/.test(name)) return pct("ranged");
  if (/^MELEE P ?DMG( BONUS)?$/.test(name)) return pct("melee");
  if (/^RANGED M ?DMG( BONUS)?$/.test(name)) return pct("rmagic");
  if (/^P ?DMG BONUS$/.test(name)) return pct("pdmg");
  if (/^M ?DMG BONUS$/.test(name)) return pct("mdmg");
  if (/^CRIT DMG$/.test(name)) return pct("critdmg");
  if (name === "CRIT") return { key: "crit", value };
  if (name === "ASPD") return pct("aspd");
  if (/^FIXED P ?DMG$/.test(name)) return { key: "fixp", value };
  if (/^FIXED M ?DMG$/.test(name)) return { key: "fixm", value };
  if (name === "ATK" || name === "P ATK" || name === "PATK") return pctSign ? pct("atkp") : { key: "atk", value };
  if (name === "M ATK" || name === "MATK") return pctSign ? pct("matkp") : { key: "matk", value };
  if (name === "HP" || name === "MAX HP") return pctSign ? pct("hpp") : { key: "hp", value };
  if (name === "DEF" || name === "P DEF") return pctSign ? null : { key: "def", value };
  if (name === "M DEF" || name === "MDEF") return pctSign ? null : { key: "mdef", value };
  if (/^(STR|AGI|VIT|INT|DEX|LUK)$/.test(name)) return { key: name.toLowerCase(), value };
  return null;
}

// ---- one screenshot of a tooltip ----------------------------------------------
const clean = (l) => l.replace(/[|｜]/g, " ").replace(/\s+/g, " ").trim();
// leading bullets and whatever OCR made of them ("+", "*", "4»", "®", "0 ")
const unbullet = (l) => l.replace(/^(?:[^A-Za-z0-9(\[]|[0-9oO@a-z]{1,2}[»«>)\]]|\b[0oO4AS]\s)+\s*/, "").trim();
const roman = (name) => name.replace(/\b[Il1|]{1,3}$/, (m) => "I".repeat(m.length)); // "Swift Attack Il" -> "Swift Attack II"
const LV = /\bLv\.?\s?:\s?(\d{1,3})\b/; // the item level under the header: "Lv.:90"

function sectionOf(line) {
  const l = unbullet(line);
  if (/^Base Stats/i.test(l)) return { kind: "base" };
  if (/^Special Skill/i.test(l)) return { kind: "special" };
  if (/^Apocalypse Attribute/i.test(l) || /Apocalypse Star/i.test(l)) return { kind: "season" };
  if (/^Apocalypse Trait/i.test(l)) return { kind: "trait" };
  // "Refine Lv.: lv.16" is a heading; "Refine Lv. x 5), up to Lv. 15" is a skill's text
  if (/^Refine Lv/i.test(l) && l.length <= 26 && !/[x(),]/i.test(l.slice(9))) return { kind: "refine" };
  if (/^Enhanced? Stats/i.test(l)) return { kind: "enhance" };
  if (/^Enchant Stone/i.test(l)) return { kind: "gem" };
  if (/^Affix Stats/i.test(l)) return { kind: "affix" };
  if (/^Set Bonus/i.test(l) || /^\[?\d\]? ?Set Effect/i.test(l)) return { kind: "set" };
  if (/^Class Limit/i.test(l)) return { kind: "class" };
  if (/^How to Obtain/i.test(l)) return { kind: "end" };
  const card = l.match(/^[^A-Za-z]*([A-Za-z][A-Za-z:'’. \-]{2,40}?)\s+Card\b[\s\W]*$/);
  if (card) return { kind: "card", name: card[1].trim() };
  const ench = l.match(/^([A-Z][A-Za-z' \-]{2,40}?)\s+Lv\.?\s*(\d{1,2})\s*:\s*$/);
  if (ench && !/Refine|Enhance|Gem/i.test(l)) return { kind: "enchant", name: roman(ench[1].trim()) };
  return null;
}

// text: OCR of one tooltip card. Returns null when it is not a gear tooltip
// (the gear list, the Enhance panel, a rune or pet card).
export function parseTip(text) {
  const lines = String(text || "").split(/\r?\n/).map(clean).filter(Boolean);
  const lvRows = lines.map((l, i) => (LV.test(l) && !/Refine|Enhance|Cap|Amplif|Gem|up to/i.test(l) ? i : -1)).filter((i) => i >= 0);
  if (lvRows.length !== 1 || lvRows[0] > 14) return null; // one "Lv.:90" right under the header; a list of gear has several
  const lvAt = lvRows[0];
  const tip = { title: "", slotWord: null, sub: null, lv: Number(lines[lvAt].match(LV)[1]), royal: false,
    refine: null, titleRefine: null, shadow: false, sections: [], cards: [] };
  // header: the title first, the slot line after it
  const slotOf = (l) => SLOT_WORDS.find(([re]) => re.test(l));
  for (const l of lines.slice(0, lvAt)) {
    if (/Overall|Rating|Ratin/i.test(l)) break;
    if (/\bR[oa]yal\b/.test(l)) tip.royal = true;
    const sw = slotOf(l);
    const startsWithSlot = sw && l.replace(/^[^A-Za-z]+/, "").search(sw[0]) === 0 && l.split(" ").length <= 6;
    if (!tip.slotWord && sw && (tip.title || startsWithSlot)) {
      tip.slotWord = sw[1];
      const sub = l.match(/[·•+\-.:«]\s*((?:[12T]H )?[A-Z][A-Za-z ]{2,14}?)(?:\s+R[a-z]yal\b.*)?$/);
      if (sub && sw[1] === "Weapon") tip.sub = sub[1].replace(/^TH /, "1H ").trim();
      continue;
    }
    if (!tip.title && !tip.slotWord && /[A-Za-z]{4,}/.test(l)) tip.title = l;
  }
  const tr = stripMarks(tip.title).match(/[+«»]\s*(\d{1,2})\.?$/);
  // a title cut off after "+1" may be +10 to +19, after "+2" may be +20: not trusted
  if (tr && Number(tr[1]) > 2 && Number(tr[1]) <= 20) tip.titleRefine = Number(tr[1]);
  if (/Shadow/i.test(tip.title)) tip.shadow = true;
  // body: sections. Lines before the first heading belong to a section that
  // started above the top of this screenshot.
  let cur = { kind: "above", lines: [] };
  tip.sections.push(cur);
  for (const l of lines.slice(lvAt + 1)) {
    const s = sectionOf(l);
    if (s) {
      if (s.kind === "end") break;
      cur = { ...s, lines: [] };
      tip.sections.push(cur);
      if (s.kind === "refine") {
        const m = unbullet(l).slice(9).match(/(\d{1,2})\D*$/);
        if (m && Number(m[1]) <= 20) tip.refine = Number(m[1]);
      }
      if (s.kind === "affix") tip.shadow = true;
      if (s.kind === "card") tip.cards.push(cur);
      continue;
    }
    if (/Amplification Lv/i.test(l)) tip.shadow = true;
    // a long line wraps: "DMG Reduction vs" / "Gunslinger%+3.04%", "Throw skill DMG" / "increased by 15%"
    const text = unbullet(l), prev = cur.lines.at(-1);
    if (prev && !/[\d%]\W*$/.test(prev) && (/(?:\bvs|\bto|\bfrom|\band|\bby|DMG|\bSkill|\bBonus|\bFixed)\W*$/i.test(prev) || /^[a-z]/.test(text))) cur.lines[cur.lines.length - 1] = `${prev} ${text}`;
    else cur.lines.push(text);
  }
  if (tip.sections.length < 2) return null; // no heading at all: the gear list, not a tooltip
  return tip;
}

// ---- several screenshots of the same piece -------------------------------------
// The data items every clue of one tooltip allows: id -> letters of the name matched.
// `strong` = the title showed enough letters that "nothing fits" means the
// item is not in the game data, not that the title was unreadable.
function candidates(tip, items, job) {
  const core = norm(titleCore(tip.title));
  const normal = SLOT_OF[tip.slotWord] || [], shadowSlot = SHADOW_SLOT_OF[tip.slotWord];
  const ats = !tip.slotWord ? null : [...(tip.shadow ? [] : normal.map((s) => SLOT_AT[s])), ...(shadowSlot && (tip.shadow || !normal.length) ? [SLOT_AT[shadowSlot]] : [])];
  const map = new Map();
  for (const i of items) {
    if (ats && !ats.includes(i.at)) continue;
    if (i.lv !== tip.lv) continue;
    if (job != null && i.jobs && !i.jobs.includes(job)) continue;
    const sc = fragmentScore(core, normName(items, i));
    if (sc) map.set(i.id, sc);
  }
  // the numbers under "Base Stats" (ATK +250, HP +1784) tell apart pieces whose
  // title is cut at the same place ("Altered Shadow Hur…" earring, shield, shoes)
  const nums = baseNumbers([tip]);
  if (nums.size) {
    const byBase = [...map].filter(([id]) => (byIdOf(items).get(id).fx || []).some(([, v]) => nums.has(v)));
    if (byBase.length) return { map: new Map(byBase), strong: core.length >= 8 };
  }
  return { map, strong: core.length >= 8 };
}
// The item's own numbers under "Base Stats": "ATK +132 (+50.0%)" gives 132. Lines about refine or
// amplification steps ("At Amplification Lv. +10, …", "Refine +5, …") are the same on many pieces and are left out.
const baseNumbers = (tips) => new Set(tips.flatMap((t) => t.sections.filter((s) => s.kind === "base").flatMap((s) => s.lines))
  .filter((l) => !/^(?:Refine|At|For|When)\b/i.test(l)).map((l) => l.match(/^[A-Za-z. ]{2,12}?\s?[+«»]\s?(\d[\d,]*)\b(?!\.\d)/)).filter(Boolean).map((m) => Number(m[1].replace(/,/g, ""))));
const idMaps = new WeakMap(), nameMaps = new WeakMap();
// norm(item name), worked out once per data set: every tooltip is compared with every item
function normName(items, i) {
  if (!nameMaps.has(items)) nameMaps.set(items, new Map(items.map((x) => [x.id, norm(x.n)])));
  return nameMaps.get(items).get(i.id);
}
function byIdOf(items) {
  if (!idMaps.has(items)) idMaps.set(items, new Map(items.map((i) => [i.id, i])));
  return idMaps.get(items);
}
// Two screenshots that both show "Base Stats" with no number in common are two pieces.
function otherPiece(g, tip) {
  const a = baseNumbers(g.tips), b = baseNumbers([tip]);
  return a.size > 0 && b.size > 0 && ![...b].some((n) => a.has(n));
}
const overlap = (a, b) => { for (const k of a.keys()) if (b.has(k)) return true; return false; };
// Two fragments of one scrolling title share a run of letters.
function sameTitle(a, b) {
  const x = norm(titleCore(a)), y = norm(titleCore(b));
  if (x.length < 4 || y.length < 4) return true; // too little to say they differ
  for (let n = Math.min(x.length, y.length); n >= 4; n--) for (let i = 0; i + n <= x.length; i++) if (y.includes(x.slice(i, i + n))) return true;
  return false;
}

// Longest run of letters two title fragments share.
function titleRun(a, b) {
  const x = norm(titleCore(a)), y = norm(titleCore(b));
  for (let n = Math.min(x.length, y.length); n >= 1; n--) for (let i = 0; i + n <= x.length; i++) if (y.includes(x.slice(i, i + n))) return { run: n, whole: n === Math.min(x.length, y.length) };
  return { run: 0, whole: false };
}
// Groups that are not next to each other but are one piece: the top halves of
// four tooltips were shot first, then their bottom halves. They are joined when
// the names agree and only one of them shows the top of the tooltip.
function sameAcrossGap(a, b) {
  if (a.lv !== b.lv || a.shadow !== b.shadow || (a.slotWord && b.slotWord && a.slotWord !== b.slotWord)) return false;
  const top = (g) => g.tips.some((t) => t.sections.some((s) => s.kind === "base"));
  if (top(a) && top(b)) return false;
  if (a.cand.size && b.cand.size && !overlap(a.cand, b.cand)) return false;
  return a.titles.some((t) => b.titles.some((u) => { const r = titleRun(t, u); return r.run >= 6 || (r.whole && r.run >= 4); }));
}

// tips: parseTip results in the order the screenshots were given (nulls are
// skipped). Screenshots of one piece come one after another, so a tip joins the
// group before it unless its slot, level or name says it is another piece.
export function groupTips(tips, items, job = null) {
  const groups = [];
  let g = null;
  tips.forEach((tip, index) => {
    if (!tip) return;
    const { map, strong } = candidates(tip, items, job);
    const fits = g && (!tip.slotWord || !g.slotWord || tip.slotWord === g.slotWord) && tip.lv === g.lv && tip.shadow === g.shadow && !otherPiece(g, tip) &&
      (map.size && g.cand.size ? overlap(map, g.cand) : g.titles.every((t) => sameTitle(t, tip.title)));
    if (!fits) {
      g = { slotWord: tip.slotWord, sub: tip.sub, lv: tip.lv, shadow: tip.shadow, royal: false, titles: [], tips: [], shots: [], cand: new Map(), unknown: false };
      groups.push(g);
    }
    g.slotWord ||= tip.slotWord; g.sub ||= tip.sub; g.royal ||= tip.royal;
    if (tip.title) g.titles.push(tip.title);
    g.tips.push(tip); g.shots.push(index);
    if (strong && !map.size) { g.unknown = true; g.cand = new Map(); } // a clear name the data does not have
    else if (map.size && !g.unknown) {
      // a candidate stays only while every title seen so far allows it
      g.cand = g.cand.size ? new Map([...g.cand].filter(([k]) => map.has(k)).map(([k, v]) => [k, v + map.get(k)])) : map;
      if (!g.cand.size) g.unknown = true;
    }
  });
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i], b = groups[j];
      if (!sameAcrossGap(a, b)) continue;
      a.slotWord ||= b.slotWord; a.sub ||= b.sub; a.royal ||= b.royal; a.unknown ||= b.unknown;
      a.titles.push(...b.titles); a.tips.push(...b.tips); a.shots.push(...b.shots);
      a.cand = a.unknown ? new Map() : !a.cand.size ? b.cand : !b.cand.size ? a.cand : new Map([...a.cand].filter(([k]) => b.cand.has(k)).map(([k, v]) => [k, v + b.cand.get(k)]));
      groups.splice(j--, 1);
    }
  }
  return groups;
}

// The item a group is, or null when the game data does not have it.
// Returns { item, sure } where sure = one item fits better than every other.
export function matchItem(group, items) {
  if (group.unknown || !group.cand.size) return null;
  const byId = byIdOf(items), baseNums = baseNumbers(group.tips);
  const ranked = [...group.cand].map(([id, score]) => {
    const i = byId.get(id);
    return { i, score, base: (i.fx || []).filter(([, v]) => baseNums.has(v)).length, tag: (i.q === 6) === group.royal ? 1 : 0, len: norm(i.n).length };
  }).sort((a, b) => b.base - a.base || b.tag - a.tag || b.score - a.score || a.len - b.len || b.i.q - a.i.q);
  const [best, next] = ranked;
  const sure = !next || best.base > next.base || best.tag > next.tag || best.score > next.score;
  return { item: best.i, sure };
}

// name read from the tooltip ("Skeleton Worker", "OHydra") -> a card (of that slot, when given)
export function matchCard(name, cards, slotCard = null) {
  const n = norm(name);
  let best = null;
  for (const c of cards) {
    if (slotCard && c.slot !== slotCard) continue;
    const cn = norm(c.name.replace(/\s*Card$/i, ""));
    if (cn.length >= 4 && n.endsWith(cn) && n.length - cn.length <= 2 && (!best || cn.length > best.len)) best = { card: c, len: cn.length };
  }
  return best?.card || null;
}

// ---- everything together ---------------------------------------------------------
const GEM = /^.{2,26}?Lv\.?\s?\S{1,2}\s?:\s?(.+)$/; // "Domineering GemLv.2:ATK%+2%", "EmeraldLv.3:DEF+6"
const MAX_CARDS = 2; // card slots on one piece of gear

// texts: OCR text of each tooltip card, in screenshot order.
// data: { items, cards } from equipment.json and cards.json; job: the picked job id, if any.
// Returns { gear: [...], read: how many of the texts were gear tooltips }.
// Each gear entry:
//   slot, slotLabel   which row of the Damage tab it fills
//   name, read        the item's name (from the data when matched) and the best reading of the title
//   item, sure        matched data item (or null: not in the game data) and whether it is the clear fit
//   lv, refine        item level; refine 0-20, or null when no screenshot showed it
//   card, cards       data card for the slot's card pick (or null), and the names of every card read
//   extras            [{ kind: "stat", key, value, label }]: the exact numbers on the tooltip that the
//                     item and the card pick do not already count (traits, enchant, gems, 2nd card, affixes)
//   skipped           [{ line, why }]: read but not counted
//   shots             indexes into `texts`
// worn: { slot id: item id } of what the gear table holds now, so a second accessory read later does
// not land on the first one.
// Also returns unplaced: pieces read whose slot could not be told or was already filled by this read.
export function readGear(texts, data, job = null, worn = {}) {
  const tips = texts.map(parseTip);
  const groups = groupTips(tips, data.items, job);
  const used = new Set();
  const gear = [];
  let unplaced = 0;
  for (const g of groups) {
    const m = matchItem(g, data.items);
    // every card section of the group, each card once however many screenshots show it
    const cardSecs = [];
    for (const t of g.tips) {
      const taken = new Set(); // two card sections in one screenshot are two cards, even with the same numbers
      for (const s of t.cards) {
        const sig = new Set(s.lines.map(statOf).filter(Boolean).map((x) => `${x.key}=${x.value}`));
        const name = norm(s.name);
        const same = cardSecs.find((c) => !taken.has(c) && (c.name.endsWith(name) || name.endsWith(c.name)) && ([...sig].every((k) => c.sig.has(k)) || [...c.sig].every((k) => sig.has(k))));
        if (!same) { const c = { name, raw: s.name, lines: s.lines, sig }; cardSecs.push(c); taken.add(c); continue; }
        taken.add(same);
        if (sig.size > same.sig.size || (sig.size === same.sig.size && s.lines.length > same.lines.length)) Object.assign(same, { lines: s.lines, sig });
      }
    }
    const keep = cardSecs.map((c, i) => ({ c, i })).sort((a, b) => b.c.sig.size - a.c.sig.size || a.i - b.i).slice(0, MAX_CARDS).sort((a, b) => a.i - b.i).map((x) => x.c);
    // slot: from the matched item, else the word under the title, else what the cards fit
    const anyCard = keep.map((c) => matchCard(c.raw, data.cards)).find(Boolean);
    const want = m ? Object.keys(SLOT_AT).filter((s) => SLOT_AT[s] === m.item.at)
      : g.slotWord ? (g.shadow || !SLOT_OF[g.slotWord] ? [SHADOW_SLOT_OF[g.slotWord]].filter(Boolean) : SLOT_OF[g.slotWord])
        : anyCard ? Object.keys(SLOT_CARD).filter((s) => SLOT_CARD[s] === anyCard.slot) : [];
    // of two like slots (Accessory 1 and 2): the one that already holds this item, else an empty one, else the first free
    const free = want.filter((s) => !used.has(s));
    const slot = free.find((s) => m && worn[s] === m.item.id) ?? free.find((s) => worn[s] == null) ?? free[0];
    if (!slot) { unplaced++; continue; } // nothing says which slot, or that slot was already read
    used.add(slot);
    const label = SLOT_LABEL[slot];
    const titles = g.titles.map(titleCore).filter(Boolean).sort((a, b) => b.length - a.length);
    const seenRefine = g.tips.map((t) => t.refine).filter((r) => r != null);
    const fromTitle = g.tips.map((t) => t.titleRefine).filter((r) => r != null);
    const refine = seenRefine.length ? seenRefine.sort((a, b) => seenRefine.filter((x) => x === b).length - seenRefine.filter((x) => x === a).length)[0]
      : fromTitle.length ? Math.max(...fromTitle) : null;
    const entry = { slot, slotLabel: label, name: m?.item.n || titles[0] || "", read: titles[0] || "", item: m?.item || null, sure: Boolean(m?.sure),
      lv: g.lv, refine, card: null, cards: [], extras: [], skipped: [], shots: g.shots };
    // A line seen in two overlapping screenshots counts once; a line that is on one screenshot twice
    // (two of the same gem) counts twice. So: per line, the most times any one screenshot shows it.
    const counted = new Map();
    let inShot = new Map();
    const add = (line, tag) => {
      const st = statOf(line);
      if (!st) {
        // defence lines are not damage: say nothing about them
        if (/\d/.test(line) && /[A-Za-z]{4}/.test(line) && line.includes(" ") && !/Reduction|taken|\bRES\b|DEF\b|Defensive/i.test(line) && !entry.skipped.some((x) => norm(x.line).slice(4) === norm(line).slice(4))) entry.skipped.push({ line, why: "no stat for it on the Damage tab" });
        return;
      }
      const id = `${tag}|${st.key}|${st.value}`;
      inShot.set(id, (inShot.get(id) || 0) + 1);
      if (inShot.get(id) <= (counted.get(id) || 0)) return; // the same line again in an overlapping screenshot
      counted.set(id, inShot.get(id));
      entry.extras.push({ kind: "stat", key: st.key, value: st.value, label: `${label} · ${tag}`.slice(0, 40) });
    };
    const above = [], known = new Set(); // known: stats under headings that are read but not counted (base, season, refine, enhance)
    for (const t of g.tips) {
      inShot = new Map();
      for (const s of t.sections) {
        if (["base", "season", "refine", "enhance", "special", "set"].includes(s.kind)) for (const l of s.lines) { const st = statOf(l); if (st) known.add(`${st.key}|${st.value}`); }
        if (s.kind === "trait" || s.kind === "affix") s.lines.forEach((l) => add(l, s.kind));
        else if (s.kind === "enchant") s.lines.forEach((l) => add(l, s.name));
        else if (s.kind === "gem") s.lines.forEach((l) => { const gm = l.match(GEM); if (gm) add(gm[1], "gem"); });
        else if (s.kind === "above") above.push(...s.lines);
      }
    }
    inShot = new Map(); // the cards were already made one each above
    const matched = keep.map((c) => matchCard(c.raw, data.cards, SLOT_CARD[slot]));
    const pickAt = matched.findIndex(Boolean); // the slot's card pick takes the first card the data has for this slot
    keep.forEach((c, n) => {
      const card = matched[n] || matchCard(c.raw, data.cards);
      const name = card?.name || `${roman(c.raw.replace(/^[0O](?=[A-Z])/, ""))} Card`;
      entry.cards.push(name);
      const inPick = n === pickAt;
      if (inPick) entry.card = card;
      // the card in the slot's card pick already counts its own main effect
      const own = new Set(inPick ? (card.fx || []).map(([k]) => k) : []);
      for (const l of c.lines) {
        const st = statOf(l);
        if (st && own.has(st.key)) { own.delete(st.key); continue; }
        add(l, `${name.replace(/\s*Card$/i, "")}${inPick ? " affix" : ` #${n + 1}`}`);
      }
    });
    // lines whose heading was above the top of the screenshot: a gem line says
    // what it is by itself; anything else is counted only if another screenshot
    // showed it under its heading
    inShot = new Map();
    const before = new Map(counted); // gem lines found here count only if no screenshot showed them under their heading
    for (const l of above) {
      const gm = l.match(GEM);
      if (gm && /Gem|Lv\.?\s?\d/i.test(l) && statOf(gm[1])) { const x = statOf(gm[1]); if (!before.has(`gem|${x.key}|${x.value}`)) add(gm[1], "gem"); continue; }
      const st = statOf(l);
      if (!st || known.has(`${st.key}|${st.value}`) || [...counted.keys()].some((id) => id.endsWith(`|${st.key}|${st.value}`))) continue;
      if (!entry.skipped.some((x) => x.line === l)) entry.skipped.push({ line: l, why: "its heading was above the screenshot" });
    }
    gear.push(entry);
  }
  return { gear, read: tips.filter(Boolean).length, unplaced };
}
