// Refine maths. Pure functions, shared by the page and the tests.
//
// Model (matches rtnw.online's own +3 -> +6 projection exactly):
//   success   -> level + 1
//   downgrade -> level - 1, never below the last safe level (6, 9, 12, 15)
//   fail      -> level stays
// Pity (a bonus after failures) exists in the data but the game's rule is not
// public, so it is left out: these numbers are the pessimistic side.

export function safeFloor(safeLevels, level) {
  let f = 0;
  for (const s of safeLevels) if (s <= level && s > f) f = s;
  return f;
}

// Success / downgrade chance (0..1) for one attempt at `lv`, after support items.
export function stepRates(lv, opts = {}) {
  let p = lv.success;
  let d = lv.downgrade;
  if (usesBlessing(lv, opts)) p += opts.blessingBonus ?? lv.blessing.bonus;
  p = Math.min(100, Math.max(0, p));
  d = Math.min(d, 100 - p);
  return { p: p / 100, d: d / 100 };
}

export function usesBlessing(lv, opts = {}) {
  return Boolean(opts.blessing && lv.blessing?.enabled && lv.level >= (opts.blessingFrom ?? 0));
}

// Starstones one attempt costs if every item is bought (materials at their
// replacement price, plus blessing ore when used).
export function attemptStarstones(lv, opts = {}) {
  let s = lv.matAmount * lv.matStarstone;
  if (usesBlessing(lv, opts)) s += lv.blessing.amount * lv.blessing.starstone;
  return s;
}

// Exact expected attempts and Starstones to go from `from` to `to`.
// Solves E[s] = c_s + p E[s+1] + d E[down(s)] + f E[s] over the reachable levels.
export function expected(data, from, to, opts = {}) {
  const lo = safeFloor(data.safeLevels, from);
  const n = to - lo;
  if (n <= 0 || from >= to) return { attempts: 0, starstones: 0, zeny: 0 };
  const byLevel = new Map(data.levels.map((l) => [l.level, l]));
  const solve = (costOf) => {
    const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
    for (let s = lo; s < to; s++) {
      const i = s - lo;
      const lv = byLevel.get(s);
      const { p, d } = stepRates(lv, opts);
      const f = 1 - p - d;
      A[i][i] += 1 - f;
      if (s + 1 < to) A[i][s + 1 - lo] -= p;
      if (d > 0) A[i][Math.max(s - 1, safeFloor(data.safeLevels, s)) - lo] -= d;
      A[i][n] = costOf(lv);
    }
    return gauss(A)[from - lo];
  };
  return {
    attempts: solve(() => 1),
    starstones: solve((lv) => attemptStarstones(lv, opts)),
    zeny: solve((lv) => lv.zeny),
  };
}

function gauss(A) {
  const n = A.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c || A[r][c] === 0) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j <= n; j++) A[r][j] -= k * A[c][j];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Monte Carlo. Returns one record per run so the page can take percentiles
// after subtracting what the player already owns.
//   opts.owned: { "Oridecon": 120, ... }   materials already in the bag
export function simulate(data, from, to, opts = {}, runs = 10000, seed = 1) {
  const rand = mulberry32(seed);
  const byLevel = data.levels.map((l) => l); // index == level
  const rates = byLevel.map((lv) => stepRates(lv, opts));
  const bless = byLevel.map((lv) => usesBlessing(lv, opts));
  const mats = [...new Set(byLevel.map((l) => l.mat))];
  const matIdx = byLevel.map((l) => mats.indexOf(l.mat));
  const matPrice = mats.map((m) => byLevel.find((l) => l.mat === m).matStarstone);
  const floors = byLevel.map((l) => safeFloor(data.safeLevels, l.level));
  const owned = mats.map((m) => opts.owned?.[m] ?? 0);
  const out = [];
  for (let r = 0; r < runs; r++) {
    let s = from;
    let attempts = 0;
    let zeny = 0;
    let blessItems = 0;
    let blessStars = 0;
    const used = new Array(mats.length).fill(0);
    while (s < to && attempts < 1e7) {
      const lv = byLevel[s];
      attempts++;
      used[matIdx[s]] += lv.matAmount;
      zeny += lv.zeny;
      if (bless[s]) {
        blessItems += lv.blessing.amount;
        blessStars += lv.blessing.amount * lv.blessing.starstone;
      }
      const x = rand();
      const { p, d } = rates[s];
      if (x < p) s++;
      else if (x < p + d) s = Math.max(s - 1, floors[s]);
    }
    let buyStars = blessStars;
    for (let i = 0; i < mats.length; i++) buyStars += Math.max(0, used[i] - owned[i]) * matPrice[i];
    out.push({ attempts, zeny, used, blessItems, starstones: buyStars });
  }
  return { mats, runs: out };
}

export function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}
