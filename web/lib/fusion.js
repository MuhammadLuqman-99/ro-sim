// Card fusion odds, following rtnw.online's model (the game's real rule for the
// weights is not public): a fused card has 1 + affixes positions; each position
// takes the main card's effect with chance wMain / (wMain + wMaterial) for two
// random effects, 50% when either is a fixed effect, 100% when both are the same
// effect or the position is locked. Positions are independent, so a fusion has
// at most 2^positions results and the odds are exact.

export function option(data, key) {
  if (!key) return null;
  return key.startsWith("fixed:") ? data.fixed[key] : data.random[key];
}
export const display = (o) => (o ? o.text ?? (o.lines?.["1"] || []).join("\n") : "");

// The effects on a card, position by position: [fixed, affix1, affix2…]
export function slotsOf(card, affixKeys) {
  return [card.fixed, ...Array.from({ length: Math.max(0, Math.min(2, card.affixes)) }, (_, i) => affixKeys?.[i] || null)];
}

// Problems that stop the fusion (empty array = allowed).
export function problems(main, mat, lock) {
  const out = [];
  if (!main || !mat) return ["Pick a main card and a material card."];
  if (main.slot !== mat.slot) out.push("Both cards must be for the same slot.");
  if (main.mvp || mat.mvp) out.push("MVP cards cannot be fused.");
  if (!(mat.q === main.q || mat.q === main.q - 1)) out.push("The material must be the same quality as the main card or one lower.");
  if (lock && mat.q !== main.q) out.push("Locking needs both cards at the same quality.");
  return out;
}

// Chance the main card's effect wins position i.
export function mainChance(data, aKey, bKey, i, lock) {
  if (lock && lock.pos === i) return lock.side === "main" ? 1 : 0;
  if (!aKey && !bKey) return null;
  if (!bKey) return 1;
  if (!aKey) return 0;
  const A = option(data, aKey), B = option(data, bKey);
  if (display(A) === display(B)) return 1;
  const wA = A?.w, wB = B?.w;
  if (wA > 0 && wB > 0) return wA / (wA + wB);
  return 0.5;
}

// Every possible fused card with its probability.
export function outcomes(data, mainSlots, matSlots, lock) {
  const n = mainSlots.length;
  let outs = [{ p: 1, keys: [] }];
  for (let i = 0; i < n; i++) {
    const a = mainSlots[i] || null, b = matSlots[i] || null;
    const pm = mainChance(data, a, b, i, lock);
    if (pm === null) { outs = outs.map((o) => ({ ...o, keys: [...o.keys, null] })); continue; }
    const next = [];
    for (const o of outs) {
      if (pm > 0) next.push({ p: o.p * pm, keys: [...o.keys, a] });
      if (pm < 1) next.push({ p: o.p * (1 - pm), keys: [...o.keys, b] });
    }
    outs = next;
  }
  return outs.sort((x, y) => y.p - x.p);
}

// Lines shown on a fused card: fixed effects shrink to 75% / 60% when the card
// ends up with 2 / 3 of them. (Cards that are immune to this have the same
// numbers in all three variants in the data, so nothing special is needed.)
// A second fixed effect can only sit in an affix position, carried over from
// an earlier fusion.
export function resultLines(data, keys) {
  const fixedCount = Math.max(1, Math.min(3, keys.filter((k) => k && option(data, k)?.decay === 2001).length));
  return keys.filter(Boolean).map((k) => {
    const o = option(data, k);
    return k.startsWith("fixed:") ? (o.lines[String(fixedCount)] || o.lines["1"]) : [o.text];
  });
}

// Chance that the fused card carries the target effect at any position.
// Effects are matched by their text: two keys with the same text are the same
// effect (the generator keeps whichever key the main card had).
export function hasEffect(data, keys, targetKey) {
  const want = display(option(data, targetKey));
  return Boolean(want) && keys.some((k) => k && display(option(data, k)) === want);
}
export function targetChance(data, outs, targetKey) {
  return outs.reduce((s, o) => s + (hasEffect(data, o.keys, targetKey) ? o.p : 0), 0);
}
