import assert from "node:assert/strict";
import test from "node:test";

import { proxyApiRequest } from "../lib/api-proxy.mjs";

const development = {
  NODE_ENV: "development",
  DEV_API_TOKEN: "test-only-token",
  NEXT_PUBLIC_API_URL: "http://inventory.local/",
};

function request(path, method = "GET", headers = {}) {
  return new Request(`http://app.local/api/v1/${path}`, {
    method,
    headers: { host: "app.local", ...headers },
    ...(method === "POST" || method === "PUT" ? { body: "{}" } : {}),
  });
}

test("rejects production requests before route or method handling", async () => {
  const response = await proxyApiRequest(
    request("dashboard"),
    ["dashboard"],
    { NODE_ENV: "production", DEV_API_TOKEN: "test-only-token" },
    fetch,
  );

  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /disabled outside Next.js development mode/);
});

test("rejects unsupported methods with an Allow header", async () => {
  const response = await proxyApiRequest(
    request("dashboard", "POST"),
    ["dashboard"],
    development,
    fetch,
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
});

test("returns 404 for inherited property names", async () => {
  for (const path of [["constructor"], ["__proto__"]]) {
    const response = await proxyApiRequest(
      request(path[0]),
      path,
      development,
      fetch,
    );
    assert.equal(response.status, 404);
  }
});

test("rejects writes without an Origin header", async () => {
  const response = await proxyApiRequest(
    request("inventory/receipts", "POST"),
    ["inventory", "receipts"],
    development,
    fetch,
  );

  assert.equal(response.status, 403);
  assert.match((await response.json()).detail, /require an Origin header/);
});

test("rejects cross-origin writes", async () => {
  const response = await proxyApiRequest(
    request("inventory/receipts", "POST", { origin: "http://other.local" }),
    ["inventory", "receipts"],
    development,
    fetch,
  );

  assert.equal(response.status, 403);
  assert.match((await response.json()).detail, /valid same-origin Origin header/);
});

test("does not trust client-supplied forwarded host headers for writes", async () => {
  const response = await proxyApiRequest(
    request("inventory/receipts", "POST", {
      origin: "http://forged.local",
      "x-forwarded-host": "forged.local",
      "x-forwarded-proto": "http",
    }),
    ["inventory", "receipts"],
    development,
    fetch,
  );

  assert.equal(response.status, 403);
});

test("reports missing server-side development token", async () => {
  const response = await proxyApiRequest(
    request("dashboard"),
    ["dashboard"],
    { ...development, DEV_API_TOKEN: "" },
    fetch,
  );

  assert.equal(response.status, 503);
  assert.match((await response.json()).detail, /Set DEV_API_TOKEN in frontend\/.env.local/);
});

test("forwards same-origin requests with the backend token", async () => {
  let forwardedUrl;
  let forwardedOptions;
  const response = await proxyApiRequest(
    request("inventory/receipts?unexpected=1", "POST", {
      origin: "http://app.local",
      "content-type": "application/json",
    }),
    ["inventory", "receipts"],
    development,
    async (url, options) => {
      forwardedUrl = url;
      forwardedOptions = options;
      return Response.json({ saved: true });
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { saved: true });
  assert.equal(forwardedUrl, "http://inventory.local/api/v1/inventory/receipts");
  assert.equal(forwardedOptions.headers.get("X-Dev-Token"), "test-only-token");
  assert.equal(forwardedOptions.headers.get("content-type"), "application/json");
});

test("preserves supported stock-history query parameters", async () => {
  let forwardedUrl;
  const response = await proxyApiRequest(
    request("stock-movements?limit=5&unexpected=1"),
    ["stock-movements"],
    development,
    async (url) => {
      forwardedUrl = url;
      return Response.json({ items: [] });
    },
  );

  assert.equal(response.status, 200);
  assert.equal(forwardedUrl, "http://inventory.local/api/v1/stock-movements?limit=5");
});
