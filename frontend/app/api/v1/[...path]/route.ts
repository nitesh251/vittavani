import { proxyApiRequest } from "../../../../lib/api-proxy.mjs";
import { getSupabaseAccessToken } from "../../../../lib/supabase/server";

type RouteContext = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: RouteContext) {
  const { path } = await context.params;
  const accessToken = await getSupabaseAccessToken();
  return proxyApiRequest(request, path, process.env, fetch, accessToken);
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
