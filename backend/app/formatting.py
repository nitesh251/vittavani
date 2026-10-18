from decimal import Decimal


def format_quantity(value: Decimal) -> str:
    if value == 0:
        return "0"
    formatted = format(value, "f")
    if "." in formatted:
        formatted = formatted.rstrip("0").rstrip(".")
    return formatted
