import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

function token(name) {
  const match = css.match(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "m"));
  assert.ok(match, `missing global --${name} design token`);
  return match[1].trim();
}

test("global design tokens match the application palette and public aliases", () => {
  assert.equal(token("navy"), "#142d4e");
  assert.equal(token("deep-navy"), "#0d2038");
  assert.equal(token("action-blue"), "#0369a1");
  assert.equal(token("teal"), "#0d9488");
  assert.equal(token("teal-hover"), "#0f766e");
  assert.equal(token("paper"), "#f8fafc");
  assert.equal(token("ink"), "#172b4d");
  assert.equal(token("muted"), "#64748b");
  assert.equal(token("line"), "#e2e8f0");
  assert.equal(token("interactive-border"), "#a5d8e8");
  assert.equal(token("info-border"), "#bae6fd");
  assert.equal(token("public-action-blue"), "var(--action-blue)");
  assert.equal(token("public-border"), "var(--line)");
});

test("shared public, auth, onboarding, and workspace controls use the design tokens", () => {
  assert.match(css, /\.topbar\s*\{[^}]*background:\s*var\(--navy\)/s);
  assert.match(css, /\.sidebar\s*\{[^}]*background:\s*var\(--navy\)/s);
  assert.match(css, /\.sidebar-nav a\.nav-active\s*\{[^}]*background:\s*var\(--action-blue\)/s);
  assert.match(css, /\.button-primary\s*\{[^}]*background:\s*var\(--action-blue\)/s);
  assert.match(css, /\.auth-page \.auth-brand \.public-brand-mark\s*\{[^}]*background:\s*var\(--navy\)/s);
  assert.match(css, /\.auth-error\s*\{[^}]*border: 1px solid var\(--error-border\);[^}]*background: var\(--error-soft\)/s);
  assert.match(css, /\.mic-listening\s*\{[^}]*background: var\(--error-soft\);[^}]*border-color: var\(--error-border\)/s);
  assert.match(css, /:where\(input:not\(\[type="checkbox"\]\).*textarea, select\)/s);
});

test("responsive and reduced-motion rules remain available", () => {
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
