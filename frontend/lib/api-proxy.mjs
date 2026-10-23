const endpointMethods = {
  ask: ["POST"],
  dashboard: ["GET"],
  "ai/status": ["GET"],
  products: ["GET", "POST"],
  locations: ["GET", "POST"],
  customers: ["GET", "POST"],
  sales: ["GET", "POST"],
  "stock-movements": ["GET"],
  business: ["GET", "POST"],
  "inventory/receipts": ["POST"],
  "inventory/adjustments": ["POST"],
  "inventory/transfers": ["POST"],
};

function isAllowedDevOrigin(request, environment) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const configuredOrigins = environment.FRONTEND_ORIGIN
    ?? (environment.NODE_ENV === "development"
      ? environment.DEV_FRONTEND_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000"
      : "");
  const allowedOrigins = configuredOrigins.split(",").map((value) => value.trim()).filter(Boolean);
  try {
    return allowedOrigins.some((allowedOrigin) => new URL(allowedOrigin).origin === new URL(origin).origin);
  } catch {
    return false;
  }
}

function isUntrustedFetchSite(request) {
  const site = request.headers.get("sec-fetch-site");
  // Same-site origins require an Origin header to be checked against the allowlist.
  return site === "cross-site" || (site === "same-site" && !request.headers.get("origin"));
}

export async function proxyApiRequest(request, path, environment, fetcher, accessToken = null) {
  if (isUntrustedFetchSite(request)) {
    return Response.json(
      { detail: "Cross-site or unverified same-site requests are not allowed." },
      { status: 403 },
    );
  }
  if (request.headers.get("origin") && !isAllowedDevOrigin(request, environment)) {
    return Response.json(
      { detail: "Requests with an Origin header must use an allowed development frontend origin." },
      { status: 403 },
    );
  }

  const endpoint = path.join("/");
  let methods = Object.prototype.hasOwnProperty.call(endpointMethods, endpoint)
    ? endpointMethods[endpoint]
    : undefined;
  if (!methods && /^products\/[0-9a-f-]{36}$/i.test(endpoint)) {
    methods = ["PUT"];
  } else if (!methods && /^customers\/[0-9a-f-]{36}$/i.test(endpoint)) {
    methods = ["PUT"];
  } else if (!methods && /^customers\/[0-9a-f-]{36}\/(?:ledger|payments)$/i.test(endpoint)) {
    methods = endpoint.endsWith("/ledger") ? ["GET"] : ["POST"];
  }
  if (!methods) {
    return Response.json({ detail: "API route not found" }, { status: 404 });
  }
  if (!methods.includes(request.method)) {
    return Response.json(
      { detail: "Method not allowed" },
      { status: 405, headers: { Allow: methods.join(", ") } },
    );
  }
  if (request.method === "POST" || request.method === "PUT") {
    if (!request.headers.get("origin")) {
      return Response.json(
        { detail: "Business-data writes require an Origin header." },
        { status: 403 },
      );
    }
    if (!isAllowedDevOrigin(request, environment)) {
      return Response.json(
        { detail: "Business-data writes require an allowed frontend Origin header." },
        { status: 403 },
      );
    }
  }

  const devToken = environment.NODE_ENV === "development" ? environment.DEV_API_TOKEN : "";
  if (!accessToken && !devToken) {
    if (environment.NODE_ENV === "development") {
      return Response.json(
        {
          detail:
            "Frontend development token is not configured. Set DEV_API_TOKEN in frontend/.env.local and restart Next.js.",
        },
        { status: 503 },
      );
    }
    return Response.json(
      {
        detail: "Authentication required.",
      },
      { status: 401 },
    );
  }
  const apiUrl = (environment.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
  const headers = new Headers({ accept: "application/json" });
  if (accessToken) headers.set("Authorization", "Bearer " + accessToken);
  else headers.set("X-Dev-Token", devToken);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);

  try {
    const queryParams = new URLSearchParams();
    if (endpoint === "stock-movements") {
      const requestedLimit = new URL(request.url).searchParams.get("limit");
      if (requestedLimit !== null) queryParams.set("limit", requestedLimit);
    }
    const queryString = queryParams.size ? `?${queryParams}` : "";
    const response = await fetcher(
      `${apiUrl}/api/v1/${path.map(encodeURIComponent).join("/")}${queryString}`,
      {
        method: request.method,
        headers,
        body:
          request.method === "POST" || request.method === "PUT"
            ? await request.arrayBuffer()
            : undefined,
        cache: "no-store",
      },
    );
    const responseHeaders = new Headers();
    const responseType = response.headers.get("content-type");
    if (responseType) responseHeaders.set("content-type", responseType);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch {
    return Response.json({ detail: "Could not reach the inventory service" }, { status: 502 });
  }
}
