import { test } from "node:test";
import assert from "node:assert/strict";
import { CURRENCIES, budgetStep, defaultBudget, formatMoney, guessCurrency, niceStep } from "../web/lib/money.js";

test("each default price matches its 12,980-Starstone pack", () => {
  const pack = { MYR: 850, THB: 6831, SGD: 266.29, IDR: 3919894, PHP: 12972.2, USD: 212.09 };
  for (const [code, price] of Object.entries(pack)) {
    const per = price / 12980;
    assert.ok(Math.abs(CURRENCIES[code].perStar - per) / per < 0.005, `${code}: ${CURRENCIES[code].perStar} vs ${per}`);
  }
});

test("money shows the symbol, cents under 100, and never cents for rupiah", () => {
  assert.equal(formatMoney(12.5, "MYR"), "RM 12.50");
  assert.equal(formatMoney(1250.4, "MYR"), "RM 1,250");
  assert.equal(formatMoney(99.5, "THB"), "฿ 99.50");
  assert.equal(formatMoney(37800.6, "IDR"), "Rp 37,801");
  assert.equal(formatMoney(5, "IDR"), "Rp 5");
  assert.equal(formatMoney(3, "nope"), "RM 3.00");
  assert.equal(formatMoney(0, "SGD"), "S$ 0.00");
});

test("small amounts keep two significant digits instead of showing 0.00", () => {
  assert.equal(formatMoney(0.0062, "SGD"), "S$ 0.0062");
  assert.equal(formatMoney(0.5, "MYR"), "RM 0.5");
});

test("the first guess follows the time zone: SEA by country, US$ elsewhere, RM when unknown", () => {
  assert.equal(guessCurrency("Asia/Bangkok"), "THB");
  assert.equal(guessCurrency("Asia/Jakarta"), "IDR");
  assert.equal(guessCurrency("Asia/Manila"), "PHP");
  assert.equal(guessCurrency("Asia/Kuala_Lumpur"), "MYR");
  assert.equal(guessCurrency("America/Los_Angeles"), "USD");
  assert.equal(guessCurrency(undefined), "MYR");
});

test("steps are 1, 2 or 5 × 10ⁿ", () => {
  assert.deepEqual([0.3, 1, 3.1, 7, 46107].map(niceStep), [1, 1, 2, 5, 20000]);
});

test("each currency starts at about RM 200 worth, on its own step", () => {
  assert.equal(defaultBudget("MYR"), 200);
  assert.equal(budgetStep("MYR"), 10);
  for (const code of Object.keys(CURRENCIES)) {
    const b = defaultBudget(code), step = budgetStep(code);
    assert.equal(b % step, 0, `${code} ${b} is on its step ${step}`);
    const rmWorth = b / CURRENCIES[code].perStar * CURRENCIES.MYR.perStar;
    assert.ok(rmWorth > 150 && rmWorth < 250, `${code}: ${b} is about RM ${rmWorth.toFixed(0)}`);
  }
});
