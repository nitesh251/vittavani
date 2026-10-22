import re
from decimal import Decimal
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from app.query_understanding import normalize_text


class CommandIntent(StrEnum):
    STOCK_QUERY = "stock_query"
    LOCATION_QUERY = "location_query"
    LOW_STOCK_QUERY = "low_stock_query"
    RECORD_SALE = "record_sale"
    RECEIVE_STOCK = "receive_stock"
    CREATE_PRODUCT = "create_product"
    UPDATE_PRODUCT = "update_product"
    TRANSFER_STOCK = "transfer_stock"
    CREATE_CUSTOMER = "create_customer"
    RECORD_CREDIT_SALE = "record_credit_sale"
    RECORD_CUSTOMER_PAYMENT = "record_customer_payment"
    CUSTOMER_BALANCE_QUERY = "customer_balance_query"
    CUSTOMER_LEDGER_QUERY = "customer_ledger_query"
    CLARIFY = "clarify"


class BusinessCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    intent: CommandIntent
    product_query: str | None = Field(default=None, max_length=180)
    quantity: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=3)
    unit: str | None = Field(default=None, max_length=32)
    customer_query: str | None = Field(default=None, max_length=160)
    amount: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    sale_price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    location_query: str | None = Field(default=None, max_length=120)
    source_location_query: str | None = Field(default=None, max_length=120)
    destination_location_query: str | None = Field(default=None, max_length=120)


_NUMERAL_TRANSLATION = str.maketrans("०१२३४५६७८९", "0123456789")
_QUANTITY = re.compile(r"(?<!\w)(\d+(?:\.\d{1,3})?)(?!\w)")
_AMOUNT = re.compile(
    r"(?<!\w)(\d+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|rupees?|rupaye|rupay|रुप(?:ये|ए)?)(?!\w)",
    re.I,
)
_UNIT_WORDS = {
    "packet", "packets", "pkt", "pkts", "piece", "pieces", "pcs",
    "unit", "units", "bottle", "bottles", "kg", "kgs", "kilogram", "kilograms",
    "gram", "grams", "g", "litre", "litres", "liter", "liters", "लिटर", "किलो",
    "पैकेट", "पैकेट्स", "पीस",
}


def _number(text: str, pattern: re.Pattern[str]) -> tuple[Decimal | None, str]:
    match = pattern.search(text)
    if match is None:
        return None, text
    return Decimal(match.group(1)), text[:match.start()] + " " + text[match.end():]


def _clean_entity(text: str) -> str | None:
    value = normalize_text(text.translate(_NUMERAL_TRANSLATION))
    value = re.sub(r"\b(?:packet|packets|pkt|pkts|piece|pieces|pcs|unit|units|bottle|bottles|kg|kgs|kilogram|kilograms|gram|grams|g|litre|litres|liter|liters|of|ke|ka|ki|ko|ne|का|के|की|को|ने|से|में)\b", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" .,!?-")
    return value or None


def interpret_command(text: str) -> BusinessCommand | None:
    """Parse only unambiguous, bounded common actions; unresolved fields require clarification."""
    normalized = normalize_text(text.translate(_NUMERAL_TRANSLATION))
    if not normalized:
        return None

    if any(word in normalized for word in ("pending", "balance", "kitna udhar", "कितना उधार")):
        customer = re.split(r"\b(?:ka|ki|ke|का|की|के)\b", normalized, maxsplit=1)[0]
        customer = _clean_entity(re.sub(r"\b(?:kitna udhar pending|kitna udhar|pending|balance)\b", " ", customer))
        return BusinessCommand(intent=CommandIntent.CUSTOMER_BALANCE_QUERY, customer_query=customer)
    if any(word in normalized for word in ("ledger", "transaction history", "hisab", "खाता")):
        customer = _clean_entity(re.sub(r"\b(?:show|view|dikhao|का|की|के|ledger|hisab|खाता)\b", " ", normalized))
        return BusinessCommand(intent=CommandIntent.CUSTOMER_LEDGER_QUERY, customer_query=customer)

    if any(phrase in normalized for phrase in ("ne de diye", "paid", "payment received", "jama kar", "दे दिए", "भुगतान")):
        amount, residue = _number(normalized, _AMOUNT)
        customer = _clean_entity(re.sub(r"\b(?:ne|de diye|paid|payment received|jama kar|customer)\b", " ", residue))
        return BusinessCommand(
            intent=CommandIntent.RECORD_CUSTOMER_PAYMENT,
            customer_query=customer,
            amount=amount,
        )

    if any(phrase in normalized for phrase in ("udhar diya", "credit sale", "on credit", "उधार दिया")):
        amount, residue = _number(normalized, _AMOUNT)
        customer = _clean_entity(re.sub(r"\b(?:ko|ka|udhar diya|credit sale|on credit)\b", " ", residue))
        return BusinessCommand(
            intent=CommandIntent.RECORD_CREDIT_SALE,
            customer_query=customer,
            amount=amount,
        )

    if normalized.startswith(("new customer ", "add customer ", "customer add ")):
        name = _clean_entity(re.sub(r"^(?:new customer|add customer|customer add)\s+", "", normalized))
        return BusinessCommand(intent=CommandIntent.CREATE_CUSTOMER, customer_query=name)

    if any(phrase in normalized for phrase in ("transfer", "move ", "se rack", "में transfer", "में bhej")):
        quantity, residue = _number(normalized, _QUANTITY)
        locations = re.search(
            r"\b(?:move|transfer)\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+?)\s*$",
            residue,
        )
        if locations:
            product_text, source, destination = locations.groups()
            product = _clean_entity(product_text)
            return BusinessCommand(
                intent=CommandIntent.TRANSFER_STOCK,
                product_query=product,
                quantity=quantity,
                source_location_query=_clean_entity(source),
                destination_location_query=_clean_entity(destination),
            )
        return BusinessCommand(intent=CommandIntent.TRANSFER_STOCK, quantity=quantity)

    if "price" in normalized or "daam" in normalized or "कीमत" in normalized:
        amount, residue = _number(normalized, _QUANTITY)
        product = _clean_entity(re.sub(r"\b(?:ka|ki|ke|price|daam|kar do|kardo|set|to)\b", " ", residue))
        return BusinessCommand(
            intent=CommandIntent.UPDATE_PRODUCT,
            product_query=product,
            sale_price=amount,
        )

    if any(phrase in normalized for phrase in ("new product", "create product", "naya product", "नया उत्पाद")):
        text_without_prefix = re.sub(r"^(?:new product|create product|naya product|नया उत्पाद)\s*", "", normalized)
        quantity, residue = _number(text_without_prefix, _QUANTITY)
        product = _clean_entity(re.sub(r"\b(?:quantity|qty|add|kar do|kardo)\b", " ", residue))
        unit_match = next((word for word in _UNIT_WORDS if re.search(rf"\b{re.escape(word)}\b", normalized)), None)
        return BusinessCommand(
            intent=CommandIntent.CREATE_PRODUCT,
            product_query=product,
            quantity=quantity,
            unit=unit_match,
        )

    if any(phrase in normalized for phrase in ("sell", "sold", "bik gaya", "bik gaye", "bech do", "बेच", "बिक गया")):
        quantity, residue = _number(normalized, _QUANTITY)
        product = _clean_entity(re.sub(r"\b(?:sell|sold|bik gaya|bik gaye|bech do|kar do|kardo)\b", " ", residue))
        unit = next((word for word in _UNIT_WORDS if re.search(rf"\b{re.escape(word)}\b", normalized)), None)
        return BusinessCommand(intent=CommandIntent.RECORD_SALE, product_query=product, quantity=quantity, unit=unit)

    if any(phrase in normalized for phrase in ("receive", "add kar do", "add stock", "stock add", "जोड़", "जोड")):
        quantity, residue = _number(normalized, _QUANTITY)
        product = _clean_entity(re.sub(r"\b(?:receive|add|add stock|stock|kar do|kardo)\b", " ", residue))
        unit = next((word for word in _UNIT_WORDS if re.search(rf"\b{re.escape(word)}\b", normalized)), None)
        return BusinessCommand(intent=CommandIntent.RECEIVE_STOCK, product_query=product, quantity=quantity, unit=unit)
    return None
