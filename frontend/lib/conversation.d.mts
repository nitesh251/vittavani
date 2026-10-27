export function contextualizeFollowUp(query: string, productName: string | null): string;
export function getOrCreateConversationId(
  storage: Pick<Storage, "getItem" | "setItem">,
  ownerId: string,
  createId: () => string,
): string;
