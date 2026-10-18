from decimal import Decimal


def is_low_stock(available: Decimal, minimum_stock: Decimal) -> bool:
    return minimum_stock > 0 and 0 < available <= minimum_stock
