import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authForm = await readFile(new URL("../components/auth-form.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../components/dashboard-app.tsx", import.meta.url), "utf8");

test("auth submit prevents duplicate requests and remains busy during redirect", () => {
  assert.match(authForm, /if \(submittingRef\.current\) return/);
  assert.match(authForm, /aria-busy=\{submitting\}/);
  assert.match(authForm, /router\.replace\(destination\)/);
  assert.match(authForm, /redirectTimeoutRef\.current = window\.setTimeout/);
  assert.match(authForm, /Signing you in…/);
});

test("authenticated topbar uses the existing primary blue token", () => {
  assert.match(css, /--action-blue:\s*#0369a1/i);
  assert.match(css, /\.topbar\s*\{[^}]*background:\s*var\(--action-blue\)/s);
  assert.match(dashboard, /conversation_id:\s*assistantConversationIdRef\.current/);
  assert.match(dashboard, /getOrCreateConversationId/);
});
