from decimal import Decimal

_FIXED_UNITS = {"kg", "g", "mg", "l", "ml", "cm", "m", "ft"}
_PROTECTED_SINGULAR_UNITS = {"bus", "class", "glass"}


def format_quantity(value: Decimal) -> str:
    if value == 0:
        return "0"
    formatted = format(value, "f")
    if "." in formatted:
        formatted = formatted.rstrip("0").rstrip(".")
    return formatted


def format_quantity_label(value: Decimal, unit: str) -> str:
    normalized_unit = unit.strip()
    if value == 1:
        singular_forms = {
            "boxes": "box",
            "buses": "bus",
            "categories": "category",
            "classes": "class",
            "feet": "foot",
            "glasses": "glass",
            "inches": "inch",
            "knives": "knife",
            "leaves": "leaf",
            "men": "man",
            "people": "person",
            "pieces": "piece",
            "shelves": "shelf",
            "women": "woman",
        }
        normalized_unit = singular_forms.get(normalized_unit.casefold(), normalized_unit)
        if (
            normalized_unit.casefold() not in _FIXED_UNITS | _PROTECTED_SINGULAR_UNITS
            and normalized_unit.casefold().endswith("s")
        ):
            normalized_unit = normalized_unit[:-1]
    else:
        plural_forms = {
            "box": "boxes",
            "bus": "buses",
            "category": "categories",
            "class": "classes",
            "foot": "feet",
            "glass": "glasses",
            "inch": "inches",
            "knife": "knives",
            "leaf": "leaves",
            "man": "men",
            "person": "people",
            "shelf": "shelves",
            "woman": "women",
        }
        if normalized_unit.casefold() not in _FIXED_UNITS:
            normalized_unit = plural_forms.get(
                normalized_unit.casefold(),
                normalized_unit if normalized_unit.casefold().endswith("s") else f"{normalized_unit}s",
            )
    return f"{format_quantity(value)} {normalized_unit}"
