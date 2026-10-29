import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const homepage = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const authForm = await readFile(new URL("../components/auth-form.tsx", import.meta.url), "utf8");
const publicHeader = await readFile(new URL("../components/public-header.tsx", import.meta.url), "utf8");
const publicFooter = await readFile(new URL("../components/public-footer.tsx", import.meta.url), "utf8");
const scrollReveals = await readFile(new URL("../components/public-scroll-reveals.tsx", import.meta.url), "utf8");

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
  assert.equal(token("muted"), "#475569");
  assert.equal(token("line"), "#dce7f3");
  assert.equal(token("soft-cyan"), "#ccfbf1");
  assert.equal(token("interactive-border"), "#a5d8e8");
  assert.equal(token("info-border"), "#bae6fd");
  assert.equal(token("public-cyan"), "var(--cyan)");
  assert.equal(token("public-action-blue"), "var(--action-blue)");
  assert.equal(token("public-soft-purple"), "var(--soft-cyan)");
  assert.equal(token("public-soft-amber"), "var(--soft-cyan)");
  assert.equal(token("public-border"), "var(--line)");
});

test("shared public, auth, onboarding, and workspace controls use the design tokens", () => {
  assert.match(css, /\.topbar\s*\{[^}]*background:\s*var\(--navy\)/s);
  assert.match(css, /\.sidebar\s*\{[^}]*background:\s*var\(--navy\)/s);
  assert.match(css, /\.public-header\s*\{[^}]*background: var\(--navy\);[^}]*color: var\(--card\)/s);
  assert.match(css, /\.public-header \.public-brand\s*\{[^}]*color: var\(--card\)/s);
  assert.match(css, /\.public-nav a\s*\{[^}]*color: #e0f2fe/s);
  assert.match(css, /\.public-nav a:hover\s*\{[^}]*color: #67e8f9/s);
  assert.match(css, /\.public-header \.public-login-link\s*\{[^}]*border-color: #ffffff70;[^}]*background: transparent;[^}]*color: var\(--card\)/s);
  assert.match(css, /\.public-header \.public-login-link:hover\s*\{[^}]*border-color: #67e8f9;[^}]*background: #ffffff18/s);
  assert.match(css, /\.button-outline\s*\{[^}]*border-color: #b6d2e7;[^}]*background: transparent/s);
  assert.match(css, /\.public-mobile-menu > summary\s*\{[^}]*color: var\(--card\)/s);
  assert.match(css, /\.sidebar-nav a\.nav-active\s*\{[^}]*background:\s*var\(--action-blue\)/s);
  assert.match(css, /\.button-primary\s*\{[^}]*background:\s*var\(--action-blue\)/s);
  assert.match(css, /\.auth-page \.auth-brand \.public-brand-mark\s*\{[^}]*background:\s*var\(--navy\)/s);
  assert.match(css, /\.auth-error\s*\{[^}]*border: 1px solid var\(--error-border\);[^}]*background: var\(--error-soft\)/s);
  assert.match(css, /\.mic-listening\s*\{[^}]*background: var\(--error-soft\);[^}]*border-color: var\(--error-border\)/s);
  assert.match(css, /\.public-footer\s*\{[^}]*background: var\(--navy\);[^}]*color: white/s);
  assert.match(css, /\.footer\s*\{[^}]*background: var\(--navy\);[^}]*color: white/s);
  assert.match(css, /\.public-auth-layout\s*\{[^}]*background: var\(--paper\)/s);
  assert.match(css, /\.public-footer a:focus-visible\s*\{[^}]*outline: 3px solid #67e8f9/s);
  assert.match(css, /\.public-page\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 100vh/s);
  assert.match(css, /\.auth-page-auth\s*\{[^}]*flex: 1;[^}]*min-height: 0;/s);
  assert.match(css, /:where\(input:not\(\[type="checkbox"\]\).*textarea, select\)/s);
});

test("homepage and auth routes share the public header/footer components", () => {
  assert.match(homepage, /import \{ PublicHeader \} from "\.\.\/components\/public-header"/);
  assert.match(homepage, /import \{ PublicFooter \} from "\.\.\/components\/public-footer"/);
  assert.match(homepage, /<PublicHeader \/>/);
  assert.match(homepage, /<PublicFooter reveal \/>/);
  assert.match(authForm, /<PublicHeader variant=\{isSignup \? "signup" : "login"\} \/>/);
  assert.match(authForm, /<PublicFooter \/>/);
  assert.match(publicHeader, /className="button button-outline public-login-link" href="\/login">Log In/);
  assert.match(publicHeader, /className="button button-primary" href="\/signup">Get Started/);
  assert.match(publicHeader, /variant === "login" \? "button button-primary" : "button button-outline public-login-link"/);
  assert.match(publicHeader, /variant === "login" \? "public-mobile-signup" : "public-mobile-login"/);
  assert.match(publicHeader, /href=\{authHref\}/);
  assert.match(publicFooter, /href="\/#features"/);
  assert.match(publicFooter, /href="\/#faq"/);
  assert.match(publicFooter, /href="\/login"/);
});

test("responsive and reduced-motion rules remain available", () => {
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.public-footer/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("public scroll reveals are progressive, one-time, staggered, and motion-aware", () => {
  assert.match(homepage, /<PublicScrollReveals \/>/);
  assert.match(homepage, /data-scroll-reveal/);
  assert.match(scrollReveals, /"IntersectionObserver" in window/);
  assert.match(scrollReveals, /prefers-reduced-motion: reduce/);
  assert.match(scrollReveals, /getBoundingClientRect\(\)\.top >= window\.innerHeight/);
  assert.match(scrollReveals, /observer\.unobserve\(entry\.target\)/);
  assert.match(scrollReveals, /observer\.disconnect\(\)/);
  assert.match(css, /\[data-scroll-reveal\]\s*\{[^}]*transition: opacity \.32s ease, transform \.32s ease/s);
  assert.match(css, /html\.scroll-reveals-enabled \[data-scroll-revealed="pending"\]\s*\{[^}]*opacity: 0;[^}]*transform: translateY\(14px\)/s);
  assert.match(css, /nth-child\(6\)\s*\{ transition-delay: 250ms; \}/);
  assert.match(css, /html\.scroll-reveals-enabled \[data-scroll-revealed="pending"\]:focus-within/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\)[\s\S]*\.auth-page-auth \.auth-card \{ animation: auth-card-enter \.2s ease-out both; \}/);
});
