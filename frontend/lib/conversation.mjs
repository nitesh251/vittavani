const quantityWords = "one|two|three|four|five|six|seven|eight|nine|ten";
const followUpSale = new RegExp(
  `^(?:i\\s+)?(?:sold|sell)\\s+(?:\\d+(?:\\.\\d{1,3})?|${quantityWords})(?:\\s+(?:unit|units|piece|pieces|packet|packets|laptop|laptops))?[.!?]*$`,
  "i",
);

export function contextualizeFollowUp(query, productName) {
  const cleanQuery = typeof query === "string" ? query.trim() : "";
  const cleanProduct = typeof productName === "string" ? productName.trim() : "";
  if (!cleanQuery || !cleanProduct || !followUpSale.test(cleanQuery)) return cleanQuery;
  return `${cleanQuery.replace(/[.!?]+$/, "")} ${cleanProduct}`;
}

export function getOrCreateConversationId(storage, ownerId, createId) {
  const key = `vittavani-assistant:${ownerId}`;
  try {
    const saved = storage.getItem(key);
    if (saved && /^[0-9a-f-]{36}$/i.test(saved)) return saved;
    const conversationId = createId();
    storage.setItem(key, conversationId);
    return conversationId;
  } catch {
    return createId();
  }
}
