import { proxyApiRequest } from "../../../../lib/api-proxy.mjs";

type RouteContext = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return proxyApiRequest(request, path, process.env, fetch);
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
