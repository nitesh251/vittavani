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

function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  const host = (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? ""
  ).split(",")[0].trim().toLowerCase();
  const protocol = (
    request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol
  ).split(",")[0].trim().replace(/:$/, "");
  if (!origin || !host) return false;
  try {
    const originUrl = new URL(origin);
    return originUrl.host.toLowerCase() === host && originUrl.protocol.replace(/:$/, "") === protocol;
  } catch {
    return false;
  }
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
    if (!isSameOrigin(request)) {
      return Response.json(
        { detail: "Inventory writes require a valid same-origin Origin header." },
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
