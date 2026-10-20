const decimalPattern = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

function parseDecimal(value) {
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
    return Math.sign(left.localeCompare(right));
  }

  const scale = Math.max(leftDecimal.scale, rightDecimal.scale);
  const leftValue = leftDecimal.coefficient * 10n ** BigInt(scale - leftDecimal.scale);
  const rightValue = rightDecimal.coefficient * 10n ** BigInt(scale - rightDecimal.scale);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}
