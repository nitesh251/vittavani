const endpointMethods = {
  ask: ["POST"],
  dashboard: ["GET"],
  "ai/status": ["GET"],
  products: ["GET", "POST"],
  locations: ["GET", "POST"],
  "stock-movements": ["GET"],
  "inventory/receipts": ["POST"],
  "inventory/adjustments": ["POST"],
  "inventory/transfers": ["POST"],
};

function isAllowedDevOrigin(request, environment) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowedOrigins = (
    environment.DEV_FRONTEND_ORIGINS
      ?? "http://localhost:3000,http://127.0.0.1:3000"
  ).split(",").map((value) => value.trim());
  try {
    return allowedOrigins.some((allowedOrigin) => new URL(allowedOrigin).origin === new URL(origin).origin);
  } catch {
    return false;
  }
}

function isCrossSiteRequest(request) {
  const site = request.headers.get("sec-fetch-site");
  return site === "cross-site";
}

export async function proxyApiRequest(request, path, environment, fetcher) {
  if (environment.NODE_ENV !== "development") {
    return Response.json(
      {
        detail:
          "The development-token proxy is disabled outside Next.js development mode. Production authentication is not configured.",
      },
      { status: 503 },
    );
  }

  if (isCrossSiteRequest(request)) {
    return Response.json({ detail: "Cross-site requests are not allowed." }, { status: 403 });
  }
  if (request.headers.get("origin") && !isAllowedDevOrigin(request, environment)) {
    return Response.json(
      { detail: "Requests with an Origin header must use an allowed development frontend origin." },
      { status: 403 },
    );
  }

  const endpoint = path.join("/");
  const methods = Object.prototype.hasOwnProperty.call(endpointMethods, endpoint)
    ? endpointMethods[endpoint]
    : /^products\/[0-9a-f-]{36}$/i.test(endpoint)
      ? ["PUT"]
      : undefined;
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
        { detail: "Inventory writes require an Origin header." },
        { status: 403 },
      );
    }
    if (!isAllowedDevOrigin(request, environment)) {
      return Response.json(
        { detail: "Inventory writes require an allowed development frontend Origin header." },
        { status: 403 },
      );
    }
  }

  const devToken = environment.DEV_API_TOKEN;
  if (!devToken) {
    return Response.json(
      {
        detail:
          "Frontend development token is not configured. Set DEV_API_TOKEN in frontend/.env.local and restart Next.js.",
      },
      { status: 503 },
    );
  }
  const apiUrl = (environment.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
  const headers = new Headers({ accept: "application/json", "X-Dev-Token": devToken });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

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
