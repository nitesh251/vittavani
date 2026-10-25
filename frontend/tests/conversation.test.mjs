import assert from "node:assert/strict";
import test from "node:test";

import { contextualizeFollowUp } from "../lib/conversation.mjs";

test("adds a database-resolved product to a short sale follow-up", () => {
  assert.equal(contextualizeFollowUp("I sold 2.", "HP Laptop"), "I sold 2 HP Laptop");
  assert.equal(contextualizeFollowUp("sold one", "HP Laptop"), "sold one HP Laptop");
});

test("does not alter complete queries or add missing context", () => {
  assert.equal(contextualizeFollowUp("I sold 2 HP laptops", "Other product"), "I sold 2 HP laptops");
  assert.equal(contextualizeFollowUp("I sold 2.", null), "I sold 2.");
});
