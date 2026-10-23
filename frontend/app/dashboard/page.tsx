import { redirect } from "next/navigation";
import DashboardApp from "../../components/dashboard-app";
import { createSupabaseServerClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

const developmentBypass = process.env.NODE_ENV === "development"
  && Boolean(process.env.DEV_API_TOKEN && process.env.DEV_BUSINESS_ID);

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    if (!developmentBypass) redirect("/login");
    return <DashboardApp />;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    if (!developmentBypass) redirect("/login");
    return <DashboardApp />;
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) redirect("/login");
  let response: Response;
  try {
    const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
    response = await fetch(`${apiUrl}/api/v1/business`, {
      headers: { Authorization: "Bearer " + session.access_token },
      cache: "no-store",
    });
  } catch {
    return <DashboardApp />;
  }
  if (response.status === 401) redirect("/login");
  if (response.status === 403 || response.status === 404) redirect("/onboarding");
  return <DashboardApp />;
}
