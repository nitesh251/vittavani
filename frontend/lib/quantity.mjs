const decimalPattern = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;
const fixedUnits = new Set(["kg", "g", "mg", "l", "ml", "cm", "m", "ft"]);
const protectedSingularUnits = new Set(["bus", "class", "glass"]);
const singularForms = new Map([
  ["boxes", "box"],
  ["buses", "bus"],
  ["categories", "category"],
  ["classes", "class"],
  ["feet", "foot"],
  ["glasses", "glass"],
  ["inches", "inch"],
  ["knives", "knife"],
  ["leaves", "leaf"],
  ["men", "man"],
  ["people", "person"],
  ["pieces", "piece"],
  ["shelves", "shelf"],
  ["women", "woman"],
]);
const pluralForms = new Map([
  ["box", "boxes"],
  ["bus", "buses"],
  ["category", "categories"],
  ["class", "classes"],
  ["foot", "feet"],
  ["glass", "glasses"],
  ["inch", "inches"],
  ["knife", "knives"],
  ["leaf", "leaves"],
  ["man", "men"],
  ["person", "people"],
  ["shelf", "shelves"],
  ["woman", "women"],
]);

function parseDecimal(value) {
  // Keep parsing bounded; over-limit values are treated as invalid and sorted last.
  if (value.length > 128) return null;
  const match = decimalPattern.exec(value);
  if (!match) return null;

  const whole = match[2] ?? "0";
  const fraction = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;

  let coefficient = BigInt(`${whole}${fraction}` || "0");
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  if (match[1] === "-") coefficient = -coefficient;
  return { coefficient, scale };
}

export function compareDecimalStrings(left, right) {
  const leftDecimal = parseDecimal(left);
  const rightDecimal = parseDecimal(right);
  if (!leftDecimal || !rightDecimal) {
    if (leftDecimal) return -1;
    if (rightDecimal) return 1;
    return left < right ? -1 : left > right ? 1 : 0;
  }

  const scale = Math.max(leftDecimal.scale, rightDecimal.scale);
  const leftValue = leftDecimal.coefficient * 10n ** BigInt(scale - leftDecimal.scale);
  const rightValue = rightDecimal.coefficient * 10n ** BigInt(scale - rightDecimal.scale);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export function formatQuantityWithUnit(quantity, unit) {
  const normalizedUnit = unit.trim();
  const key = normalizedUnit.toLowerCase();
  let label = normalizedUnit;
  if (Number(quantity) === 1) {
    label = singularForms.get(key) ?? normalizedUnit;
    if (!fixedUnits.has(label.toLowerCase())
      && !protectedSingularUnits.has(label.toLowerCase())
      && label.toLowerCase().endsWith("s")) {
      label = label.slice(0, -1);
    }
  } else if (!fixedUnits.has(key)) {
    label = pluralForms.get(key) ?? (key.endsWith("s") ? normalizedUnit : `${normalizedUnit}s`);
  }
  return `${quantity} ${label}`;
}
