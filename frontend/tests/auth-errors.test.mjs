import assert from "node:assert/strict";
import test from "node:test";

import { getAuthErrorMessage } from "../lib/auth-errors.mjs";

test("maps common authentication failures to actionable, sanitized messages", () => {
  assert.match(getAuthErrorMessage(new Error("Invalid login credentials"), "login"), /email or password is incorrect/i);
  assert.match(getAuthErrorMessage(new Error("Email not confirmed"), "login"), /verify your email/i);
  assert.match(getAuthErrorMessage(new Error("Too many requests"), "signup"), /Too many attempts/);
  assert.match(getAuthErrorMessage(new Error("User already registered"), "signup"), /already exists/i);
});

test("does not expose unknown provider error details", () => {
  const secretDetail = "provider failure with private diagnostic";
  assert.doesNotMatch(getAuthErrorMessage(new Error(secretDetail), "login"), /private diagnostic/);
});
