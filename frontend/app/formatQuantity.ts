const fixedUnits = new Set(["kg", "g", "mg", "l", "ml", "cm", "m", "ft"]);
const protectedSingularUnits = new Set(["bus", "class", "glass"]);

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
  if (fixedUnits.has(unit.toLowerCase())) return `${quantity} ${unit}`;
  if (numericValue === "1" || numericValue === "1.0" || /^1\.0+$/.test(numericValue)) {
    const singular: Record<string, string> = {
      boxes: "box", buses: "bus", categories: "category", classes: "class", feet: "foot",
      glasses: "glass", inches: "inch", knives: "knife", leaves: "leaf", men: "man",
      people: "person", pieces: "piece", shelves: "shelf", women: "woman",
    };
    const word = singular[unit.toLowerCase()]
      ?? (unit.toLowerCase().endsWith("s") && !protectedSingularUnits.has(unit.toLowerCase())
        ? unit.slice(0, -1)
        : unit);
    return `${quantity} ${word}`;
  }
  const plural: Record<string, string> = {
    box: "boxes", bus: "buses", category: "categories", class: "classes", foot: "feet",
    glass: "glasses", inch: "inches", knife: "knives", leaf: "leaves", man: "men",
    person: "people", shelf: "shelves", woman: "women",
  };
  const word = plural[unit.toLowerCase()] ?? (unit.toLowerCase().endsWith("s") ? unit : `${unit}s`);
  return `${quantity} ${word}`;
}
