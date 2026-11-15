// node --test test/   (needs ./scripts/fetch-data.sh to have run once)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { expected, simulate, percentile, safeFloor, stepRates } from "../web/lib/refine.js";

const path = new URL("../web/data/refine.json", import.meta.url);
const data = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
const skip = data ? false : "run ./scripts/fetch-data.sh first";

test("safe floor picks the highest safe level at or below", () => {
  const safe = [6, 9, 12, 15];
  assert.equal(safeFloor(safe, 5), 0);
  assert.equal(safeFloor(safe, 6), 6);
  assert.equal(safeFloor(safe, 11), 9);
  assert.equal(safeFloor(safe, 19), 15);
});

test("+3 to +6 matches the site's own projection (no downgrade range)", { skip }, () => {
  const site = data.siteProjections.find((m) => m.from === 3 && m.to === 6);
  assert.ok(Math.abs(expected(data, 3, 6).attempts - site.attempts) < 0.01);
});

test("without pity we are never cheaper than the site's projection", { skip }, () => {
  for (const m of data.siteProjections) {
    const ours = expected(data, m.from, m.to).attempts;
    assert.ok(ours >= m.attempts - 0.01, `${m.from}->${m.to}: ours ${ours} < site ${m.attempts}`);
  }
});

test("Monte Carlo mean agrees with the exact expectation", { skip }, () => {
  for (const [a, b] of [[6, 9], [9, 12], [12, 15]]) {
    const exact = expected(data, a, b);
    const { runs } = simulate(data, a, b, {}, 20000, 7);
    const mean = runs.reduce((s, r) => s + r.attempts, 0) / runs.length;
    const meanStars = runs.reduce((s, r) => s + r.starstones, 0) / runs.length;
    assert.ok(Math.abs(mean / exact.attempts - 1) < 0.03, `${a}->${b} attempts ${mean} vs ${exact.attempts}`);
    assert.ok(Math.abs(meanStars / exact.starstones - 1) < 0.03, `${a}->${b} stars ${meanStars} vs ${exact.starstones}`);
  }
});

test("a run never drops below the safe level it started on", { skip }, () => {
  // From +9 the item can fall to +9 at worst, so each run needs >= 3 attempts and
  // the sim must finish; a broken floor would make +9->+12 blow up.
  const { runs } = simulate(data, 9, 12, {}, 2000, 3);
  assert.ok(runs.every((r) => r.attempts >= 3));
});

test("owned materials cut the Starstone bill and never make it negative", { skip }, () => {
  const base = simulate(data, 6, 9, {}, 3000, 5).runs;
  const lots = simulate(data, 6, 9, { owned: { Oridecon: 1e9 } }, 3000, 5).runs;
  assert.ok(lots.every((r) => r.starstones === 0));
  assert.ok(base.some((r) => r.starstones > 0));
});

test("blessing raises success only where the data allows it and from the chosen level", { skip }, () => {
  const lv7 = data.levels[7]; // enabled in data
  const lv9 = data.levels[9]; // disabled in data
  assert.ok(stepRates(lv7, { blessing: true, blessingBonus: 10 }).p > stepRates(lv7).p);
  assert.equal(stepRates(lv9, { blessing: true, blessingBonus: 10 }).p, stepRates(lv9).p);
  assert.equal(stepRates(lv7, { blessing: true, blessingBonus: 10, blessingFrom: 8 }).p, stepRates(lv7).p);
});

test("percentile picks the right rank", () => {
  const xs = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(xs, 0.5), 50);
  assert.equal(percentile(xs, 0.9), 90);
  assert.equal(percentile(xs, 1), 100);
});
