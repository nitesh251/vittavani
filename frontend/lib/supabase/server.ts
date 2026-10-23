import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicConfig } from "./config";

export async function createSupabaseServerClient() {
  const config = getSupabasePublicConfig();
  if (!config) return null;

  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: { secure: process.env.NODE_ENV === "production", sameSite: "lax" },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Middleware persists refreshed cookies for server-rendered pages.
        }
      },
    },
  });
}

export async function getSupabaseAccessToken() {
  const client = await createSupabaseServerClient();
  if (!client) return null;
  try {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return null;
    const { data: { session } } = await client.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}
