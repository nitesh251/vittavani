from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.sql.selectable import Subquery

from app.models import InventoryBalance


def is_low_stock(available: Decimal, minimum_stock: Decimal) -> bool:
    return minimum_stock > 0 and 0 < available <= minimum_stock


def inventory_totals_subquery(business_id: UUID) -> Subquery:
    return (
        select(
            InventoryBalance.product_id.label("product_id"),
            func.sum(InventoryBalance.quantity).label("quantity"),
        )
        .where(InventoryBalance.business_id == business_id)
        .group_by(InventoryBalance.product_id)
        .subquery()
    )
