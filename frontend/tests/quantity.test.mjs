import assert from "node:assert/strict";
import test from "node:test";

import { compareDecimalStrings } from "../lib/quantity.mjs";

test("compares large decimal quantities without floating-point loss", () => {
  assert.equal(compareDecimalStrings("9007199254740993.001", "9007199254740993.000"), 1);
  assert.equal(compareDecimalStrings("9007199254740992", "9007199254740993"), -1);
});

test("compares equivalent decimals with different precision as equal", () => {
  assert.equal(compareDecimalStrings("0.500", "0.5"), 0);
  assert.equal(compareDecimalStrings("20", "20.000"), 0);
});

test("orders positive, negative, and fractional quantities", () => {
  assert.equal(compareDecimalStrings("-0.5", "0"), -1);
  assert.equal(compareDecimalStrings("-2.01", "-2.001"), -1);
  assert.equal(compareDecimalStrings("0.001", "0.01"), -1);
});

test("falls back safely for non-decimal representations", () => {
  assert.doesNotThrow(() => compareDecimalStrings("1e-7", "1e-8"));
  assert.doesNotThrow(() => compareDecimalStrings("invalid", "1"));
});
