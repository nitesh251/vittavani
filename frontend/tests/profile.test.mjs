import assert from "node:assert/strict";
import test from "node:test";

import {
  getDisplayName,
  getProfileImageUrl,
  getProfileInitials,
  getTimeGreeting,
} from "../lib/profile.mjs";

test("uses authenticated profile names without exposing an email prefix", () => {
  assert.equal(getDisplayName({ email: "shop@example.com", user_metadata: { full_name: "  Ravi Kumar " } }), "Ravi Kumar");
  assert.equal(getDisplayName({ email: "shop@example.com", user_metadata: {} }), "");
  assert.equal(getDisplayName(null), "");
});

test("derives initials from name or email and handles missing identity", () => {
  assert.equal(getProfileInitials("Ravi Kumar", "shop@example.com"), "RK");
  assert.equal(getProfileInitials("", "shop.owner@example.com"), "SO");
  assert.equal(getProfileInitials("", null), "?");
});

test("accepts only HTTPS profile images", () => {
  assert.equal(getProfileImageUrl({ user_metadata: { avatar_url: "https://images.example/avatar.png" } }), "https://images.example/avatar.png");
  assert.equal(getProfileImageUrl({ user_metadata: { avatar_url: "javascript:alert(1)" } }), null);
  assert.equal(getProfileImageUrl({ user_metadata: {} }), null);
});

test("uses the workspace timezone to choose greeting", () => {
  const morningInIndia = new Date("2026-10-25T01:30:00.000Z");
  const afternoonInIndia = new Date("2026-10-25T07:30:00.000Z");
  const eveningInIndia = new Date("2026-10-25T12:30:00.000Z");
  assert.equal(getTimeGreeting(morningInIndia, "Asia/Kolkata"), "Good morning");
  assert.equal(getTimeGreeting(afternoonInIndia, "Asia/Kolkata"), "Good afternoon");
  assert.equal(getTimeGreeting(eveningInIndia, "Asia/Kolkata"), "Good evening");
});
