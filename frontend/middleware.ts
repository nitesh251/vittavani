import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "./lib/supabase/config";

export async function middleware(request: NextRequest) {
  const isProtectedPage = request.nextUrl.pathname.startsWith("/dashboard")
    || request.nextUrl.pathname === "/onboarding";
  const developmentBypass = process.env.NODE_ENV === "development"
    && Boolean(process.env.DEV_API_TOKEN && process.env.DEV_BUSINESS_ID);
  const config = getSupabasePublicConfig();

  if (!config) {
    if (isProtectedPage && !developmentBypass) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: { secure: process.env.NODE_ENV === "production", sameSite: "lax" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch {
    user = null;
  }

  if (isProtectedPage && !user && !developmentBypass) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding", "/api/v1/:path*"],
};
