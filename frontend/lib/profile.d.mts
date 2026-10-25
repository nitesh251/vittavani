export type ProfileIdentity = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export function getDisplayName(user: ProfileIdentity | null | undefined): string;
export function getProfileInitials(name: string, email?: string | null): string;
export function getProfileImageUrl(user: ProfileIdentity | null | undefined): string | null;
export function getTimeGreeting(date: Date, timezone: string): string;
