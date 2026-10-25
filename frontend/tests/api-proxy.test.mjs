import assert from "node:assert/strict";
import test from "node:test";

import { proxyApiRequest } from "../lib/api-proxy.mjs";

const development = {
  NODE_ENV: "development",
  DEV_API_TOKEN: "test-only-token",
  NEXT_PUBLIC_API_URL: "http://inventory.local/",
};

function request(path, method = "GET", headers = {}) {
  return new Request(`http://localhost:3000/api/v1/${path}`, {
    method,
    headers: { host: "localhost:3000", ...headers },
    ...(method === "POST" || method === "PUT" ? { body: "{}" } : {}),
  });
}

test("rejects unauthenticated production API requests", async () => {
  const response = await proxyApiRequest(
    request("dashboard"),
    ["dashboard"],
    { NODE_ENV: "production", DEV_API_TOKEN: "test-only-token" },
    fetch,
  );

  assert.equal(response.status, 401);
  assert.match((await response.json()).detail, /Authentication required/);
});

test("forwards a server-verified session token to protected production APIs", async () => {
  let forwardedOptions;
  const response = await proxyApiRequest(
    request("dashboard"),
    ["dashboard"],
    { NODE_ENV: "production", NEXT_PUBLIC_API_URL: "https://api.example" },
    async (_url, options) => {
      forwardedOptions = options;
      return Response.json({ ok: true });
    },
    "session-access-token",
  );

  assert.equal(response.status, 200);
  assert.equal(forwardedOptions.headers.get("Authorization"), ["Bearer", "session-access-token"].join(" "));
  assert.equal(forwardedOptions.headers.has("X-Dev-Token"), false);
});

test("allows business onboarding through the API proxy", async () => {
  let forwardedUrl;
  const response = await proxyApiRequest(
    request("business", "POST", { origin: "http://localhost:3000" }),
    ["business"],
    development,
    async (url) => {
      forwardedUrl = url;
      return Response.json({ id: "business-id" }, { status: 201 });
    },
    "session-access-token",
  );

  assert.equal(response.status, 201);
  assert.equal(forwardedUrl, "http://inventory.local/api/v1/business");
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
  assert.match((await response.json()).detail, /allowed frontend origin/);
});

test("rejects cross-site GET requests", async () => {
  const response = await proxyApiRequest(
    request("dashboard", "GET", { "sec-fetch-site": "cross-site" }),
    ["dashboard"],
    development,
    fetch,
  );

  assert.equal(response.status, 403);
  assert.match((await response.json()).detail, /Cross-site or unverified same-site requests/);
});

test("rejects same-site GET requests without an Origin header", async () => {
  const response = await proxyApiRequest(
    request("dashboard", "GET", { "sec-fetch-site": "same-site" }),
    ["dashboard"],
    development,
    fetch,
  );

  assert.equal(response.status, 403);
  assert.match((await response.json()).detail, /unverified same-site requests/);
});

test("allows explicitly configured same-site frontend origins", async () => {
  const response = await proxyApiRequest(
    request("dashboard", "GET", {
      origin: "http://localhost:3001",
      "sec-fetch-site": "same-site",
    }),
    ["dashboard"],
    { ...development, DEV_FRONTEND_ORIGINS: "http://localhost:3001" },
    async () => Response.json({ ok: true }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("rejects a foreign Origin on read requests", async () => {
  const response = await proxyApiRequest(
    request("dashboard", "GET", { origin: "http://forged.local" }),
    ["dashboard"],
    development,
    fetch,
  );

  assert.equal(response.status, 403);
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
      origin: "http://localhost:3000",
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

test("forwards customer, supplier, payable, and sales requests with idempotency keys", async () => {
  const headers = {
    origin: "http://localhost:3000",
    "Idempotency-Key": "customer-operation-1",
  };
  const forwarded = [];
  const fetcher = async (url, options) => {
    forwarded.push({ url, options });
    return Response.json({ ok: true });
  };
  const customerId = "00000000-0000-0000-0000-000000000001";
  const supplierId = "00000000-0000-0000-0000-000000000002";
  for (const [path, method] of [
    ["customers", "POST"],
    [`customers/${customerId}/ledger`, "GET"],
    [`customers/${customerId}/payments`, "POST"],
    ["suppliers", "GET"],
    ["suppliers", "POST"],
    [`suppliers/${supplierId}/purchases`, "GET"],
    [`suppliers/${supplierId}/payments`, "POST"],
    ["supplier-purchases", "POST"],
    ["sales", "POST"],
  ]) {
    await proxyApiRequest(request(path, method, headers), path.split("/"), development, fetcher);
  }

  assert.equal(forwarded.length, 9);
  for (const { options } of forwarded) {
    assert.equal(options.headers.get("Idempotency-Key"), "customer-operation-1");
    assert.equal(options.headers.get("X-Dev-Token"), "test-only-token");
  }
});
