from decimal import Decimal
from uuid import UUID

from app.config import settings
from app.database import SessionLocal
from app.models import Business, InventoryBalance, Location, Product, ProductAlias


def main() -> None:
    if settings.app_env != "development":
        raise SystemExit("Demo data can only be created when APP_ENV=development.")
    if not settings.dev_business_id:
        raise SystemExit("Set DEV_BUSINESS_ID before running the development seed command.")
    business_id = UUID(settings.dev_business_id)
    with SessionLocal.begin() as session:
        if session.get(Business, business_id) is not None:
            raise SystemExit("The configured development business already exists; refusing to overwrite it.")
        business = Business(
            id=business_id,
            name="Vittavani Demo Shop",
            preferred_language="hi",
            currency="INR",
            timezone="Asia/Kolkata",
        )
        storeroom = Location(id=UUID("00000000-0000-0000-0000-000000000010"), business_id=business_id, name="Storeroom")
        rack = Location(
            id=UUID("00000000-0000-0000-0000-000000000011"),
            business_id=business_id,
            parent_location_id=storeroom.id,
            name="Rack B",
        )
        shelf = Location(
            id=UUID("00000000-0000-0000-0000-000000000012"),
            business_id=business_id,
            parent_location_id=rack.id,
            name="Shelf 2",
        )
        butter = Product(
            id=UUID("00000000-0000-0000-0000-000000000020"),
            business_id=business_id,
            name="Amul Butter",
            unit="packet",
            selling_price=Decimal("56.00"),
        )
        session.add(business)
        session.flush()
        session.add(storeroom)
        session.flush()
        session.add(rack)
        session.flush()
        session.add(shelf)
        session.add(butter)
        session.flush()
        session.add_all(
            [
                ProductAlias(business_id=business_id, product_id=butter.id, alias="अमूल बटर"),
                ProductAlias(business_id=business_id, product_id=butter.id, alias="Amul makhan"),
                InventoryBalance(
                    business_id=business_id,
                    product_id=butter.id,
                    location_id=shelf.id,
                    quantity=Decimal("20"),
                ),
            ]
        )
    print("Created the explicit development demo business and inventory.")


if __name__ == "__main__":
    main()
