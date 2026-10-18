import { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ path: string[] }> };

const allowedEndpoints = new Set([
  "ask",
  "dashboard",
  "ai/status",
  "products",
  "locations",
  "stock-movements",
  "inventory/receipts",
  "inventory/adjustments",
  "inventory/transfers",
]);

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = (
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? ""
  ).split(",")[0].trim().toLowerCase();
  const protocol = (
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol
  ).split(",")[0].trim().replace(/:$/, "");
  if (!origin || !host) return false;
  try {
    const originUrl = new URL(origin);
    return originUrl.host.toLowerCase() === host && originUrl.protocol.replace(/:$/, "") === protocol;
  } catch {
    return false;
  }
}

async function forward(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const endpoint = path.join("/");
  if (!allowedEndpoints.has(endpoint) && !/^products\/[0-9a-f-]{36}$/i.test(endpoint)) {
    return Response.json({ detail: "API route not found" }, { status: 404 });
  }
  if (request.method === "POST" || request.method === "PUT") {
    if (!isSameOrigin(request)) {
      return Response.json({ detail: "Cross-origin inventory writes are not allowed" }, { status: 403 });
    }
  }

  const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
  const headers = new Headers({ accept: "application/json" });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (process.env.NODE_ENV === "development") {
    const devToken = process.env.DEV_API_TOKEN ?? process.env.NEXT_PUBLIC_DEV_API_TOKEN;
    if (!devToken) {
      return Response.json(
        {
          detail:
            "Frontend development token is not configured. Set DEV_API_TOKEN in frontend/.env.local and restart Next.js.",
        },
        { status: 503 },
      );
    }
    headers.set("X-Dev-Token", devToken);
  }

  try {
    const response = await fetch(
      `${apiUrl}/api/v1/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
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

export const GET = forward;
export const POST = forward;
export const PUT = forward;
