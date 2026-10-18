export function formatQuantity(value: string) {
  const match = value.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
  if (!match) return value;
  const [, sign, integer, rawFraction = ""] = match;
  const whole = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = rawFraction.replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function formatQuantityLabel(value: string, unit: string) {
  const quantity = formatQuantity(value);
  const numericValue = value.trim();
  const immutableUnits = new Set(["kg", "g", "mg", "l", "ml", "cm", "m", "ft"]);
  if (immutableUnits.has(unit.toLowerCase())) return `${quantity} ${unit}`;
  if (numericValue === "1" || numericValue === "1.0" || /^1\.0+$/.test(numericValue)) {
    const singular: Record<string, string> = { boxes: "box", categories: "category", feet: "foot", glasses: "glass", inches: "inch", knives: "knife", leaves: "leaf", men: "man", people: "person", pieces: "piece", shelves: "shelf", women: "woman" };
    const word = singular[unit.toLowerCase()] ?? (unit.toLowerCase().endsWith("s") ? unit.slice(0, -1) : unit);
    return `${quantity} ${word}`;
  }
  const plural: Record<string, string> = { box: "boxes", category: "categories", foot: "feet", glass: "glasses", inch: "inches", knife: "knives", leaf: "leaves", man: "men", person: "people", shelf: "shelves", woman: "women" };
  const word = plural[unit.toLowerCase()] ?? (unit.toLowerCase().endsWith("s") ? unit : `${unit}s`);
  return `${quantity} ${word}`;
}
