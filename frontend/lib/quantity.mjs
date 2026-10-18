export function compareDecimalStrings(left, right) {
  const decimalPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
  if (!decimalPattern.test(left) || !decimalPattern.test(right)) {
    return left.localeCompare(right);
  }
  const precision = Math.max(left.split(".")[1]?.length ?? 0, right.split(".")[1]?.length ?? 0);
  const scale = BigInt(`1${"0".repeat(precision)}`);
  const toScaledInteger = (value) => {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const fractional = BigInt(fraction.padEnd(precision, "0") || "0");
    const amount = BigInt(whole || "0") * scale + fractional;
    return negative ? -amount : amount;
  };
  const leftValue = toScaledInteger(left);
  const rightValue = toScaledInteger(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}
