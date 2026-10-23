"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./config";

export function getSupabaseBrowserClient() {
  const config = getSupabasePublicConfig();
  return config ? createBrowserClient(config.url, config.key) : null;
}
