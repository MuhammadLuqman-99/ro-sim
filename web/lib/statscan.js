// Read stats out of OCR text from a character-screen screenshot.
// Pure function: text in, [{ key, value, label, raw }] out. Percent stats come
// back as fractions (18% -> 0.18). Nothing here touches the network.

const RACES = ["Demi-Human", "Human", "Brute", "Demon", "Plant", "Undead", "Formless", "Fish", "Insect", "Angel", "Dragon", "Mech"];
const SIZES = ["Small", "Medium", "Large"];
const ELEMS = ["Neutral", "Water", "Earth", "Fire", "Wind", "Poison", "Holy", "Shadow", "Ghost", "Undead"];
const RACE_KEY = (w) => `race:${/^(demi-?human|human)$/i.test(w) ? "Demi-Human" : cap(w)}`;
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

// Most specific first: "P.DMG Reduction" before "P.DMG", "CRIT DMG" before "CRIT".
const LABELS = [
  [/\bCRIT\s*DMG\s*(?:RES(?:istance)?|Reduction)\b/i, () => "critdmgres", true],
  [/\bCRIT(?:ical)?\s*DMG\b/i, () => "critdmg", true],
  [/\bCRIT\s*RES(?:istance)?\b/i, () => "critres", false],
  // reductions first, so "Ranged P.DMG Reduction" is never read as the ranged bonus
  [/\bMelee\s*P\.?\s*DMG\s*Reduction/i, () => "mpred", true],
  [/\bRanged\s*P\.?\s*DMG\s*Reduction/i, () => "rpred", true],
  [/\bRanged\s*M\.?\s*DMG\s*Reduction/i, () => "rmred", true],
  [/\bMelee\s*P\.?\s*DMG(?:\s*Bonus)?/i, () => "melee", true],
  [/\bRanged\s*P\.?\s*DMG(?:\s*Bonus)?/i, () => "ranged", true],
  [/\bRanged\s*M\.?\s*DMG(?:\s*Bonus)?/i, () => "rmagic", true],
  [/\bP\.?\s*DMG\s*Reduction/i, () => "pred", true],
  [/\bM\.?\s*DMG\s*Reduction/i, () => "mred", true],
  [/\bP\.?\s*DMG(?:\s*Bonus)?/i, () => "pdmg", true],
  [/\bM\.?\s*DMG(?:\s*Bonus)?/i, () => "mdmg", true],
  [/\bReceived\s*Healing(?:\s*Bonus)?|\bHealing\s*Received/i, () => "rheal", true],
  [/\bHealing(?:\s*(?:Bonus|Effect))?\b/i, () => "heal", true],
  [new RegExp(`\\bDMG\\s*(?:vs\\.?|to)\\s*(${RACES.join("|")})\\b`, "i"), (m) => RACE_KEY(m[1]), true],
  [new RegExp(`\\bDMG\\s*(?:vs\\.?|to)\\s*(${SIZES.join("|")})\\b`, "i"), (m) => `size:${cap(m[1])}`, true],
  [new RegExp(`\\b(${ELEMS.join("|")})\\s*DMG\\b(?!\\s*Reduction)`, "i"), (m) => `elem:${cap(m[1])}`, true],
  [/\bCRIT(?:\s*Rate)?\b/i, () => "crit", false],
  [/\bASPD\b/i, () => "aspd", true],
  [/\bM\.?\s*ATK\b|\bMATK\b/i, () => "matk", false],
  [/\bP\.?\s*ATK\b|\bATK\b/i, () => "atk", false],
  [/\bM\.?\s*DEF\b|\bMDEF\b/i, () => "mdef", false],
  [/\bP\.?\s*DEF\b|\bDEF\b/i, () => "def", false],
  [/\bMax\s*HP\b|\bHP\b/i, () => "hp", false],
  [/\bHIT\b/i, () => "hit", false],
  [/\bFLEE\b/i, () => "flee", false],
  [/\bSTR\b/, () => "str", false], [/\bAGI\b/, () => "agi", false], [/\bVIT\b/, () => "vit", false],
  [/\bINT\b/, () => "int", false], [/\bDEX\b/, () => "dex", false], [/\bLUK\b/, () => "luk", false],
];

// "2,345", "18.5%", "150 + 45" (base + bonus, as the stat window shows it)
const NUMBER = /([+-]?\d{1,3}(?:,\d{3})+|[+-]?\d+(?:\.\d+)?)\s*(%)?(?:\s*\+\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(%)?)?/;
const num = (s) => Number(String(s).replace(/,/g, ""));

export function parseStats(text) {
  const found = new Map();
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/[|｜]/g, " ").replace(/\s+/g, " ").trim();
    if (!line) continue;
    // every label in the line, without overlaps
    const hits = [];
    for (const [re, keyOf, pct] of LABELS) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      for (const m of line.matchAll(g)) {
        const start = m.index, end = m.index + m[0].length;
        if (hits.some((h) => h.start < end && start < h.end)) continue;
        hits.push({ start, end, key: keyOf(m), pct, label: m[0] });
      }
    }
    hits.sort((a, b) => a.start - b.start);
    // the number that follows each label, before the next label
    hits.forEach((h, i) => {
      const stop = i + 1 < hits.length ? hits[i + 1].start : line.length;
      const m = line.slice(h.end, stop).match(NUMBER);
      if (!m || found.has(h.key)) return;
      let v = num(m[1]) + (m[3] ? num(m[3]) : 0);
      if (!Number.isFinite(v)) return;
      if (h.pct) v = v / 100;
      found.set(h.key, { key: h.key, value: v, label: h.label.trim(), raw: line });
    });
  }
  return [...found.values()];
}
