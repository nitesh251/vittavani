import assert from "node:assert/strict";
import test from "node:test";

import {
  contextualizeFollowUp,
  getOrCreateConversationId,
} from "../lib/conversation.mjs";

test("adds a database-resolved product to a short sale follow-up", () => {
  assert.equal(contextualizeFollowUp("I sold 2.", "HP Laptop"), "I sold 2 HP Laptop");
  assert.equal(contextualizeFollowUp("sold one", "HP Laptop"), "sold one HP Laptop");
});

test("does not alter complete queries or add missing context", () => {
  assert.equal(contextualizeFollowUp("I sold 2 HP laptops", "Other product"), "I sold 2 HP laptops");
  assert.equal(contextualizeFollowUp("I sold 2.", null), "I sold 2.");
});

test("persists a stable conversation ID for the active tab", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let nextId = 0;
  const createId = () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;

  const firstTabId = getOrCreateConversationId(storage, "active-tab", createId);
  assert.equal(getOrCreateConversationId(storage, "active-tab", createId), firstTabId);
  assert.notEqual(getOrCreateConversationId(storage, "another-tab", createId), firstTabId);
});

test("recovers when session storage is unavailable", () => {
  let nextId = 0;
  const storage = {
    getItem: () => { throw new Error("storage unavailable"); },
    setItem: () => { throw new Error("storage unavailable"); },
  };
  const createId = () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;

  assert.match(getOrCreateConversationId(storage, "user-a", createId), /^[0-9a-f-]{36}$/i);
});
