export function getDisplayName(user) {
  const metadata = user?.user_metadata;
  for (const value of [metadata?.full_name, metadata?.name, metadata?.display_name]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return typeof user?.email === "string" ? user.email.split("@")[0] : "";
}

export function getProfileInitials(name, email) {
  const source = name || email?.split("@")[0] || "";
  const parts = source.split(/[\s._+-]+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((part) => part[0].toLocaleUpperCase()).join("");
}

export function getProfileImageUrl(user) {
  const metadata = user?.user_metadata;
  const image = metadata?.avatar_url ?? metadata?.picture;
  if (typeof image !== "string") return null;
  try {
    const url = new URL(image);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function getTimeGreeting(date, timezone) {
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timezone,
    }).format(date));
  } catch {
    hour = date.getHours();
  }
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
