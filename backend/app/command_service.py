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
    UNSUPPORTED = "unsupported_request"
    CREATE_CUSTOMER = "create_customer"
    RECORD_CREDIT_SALE = "record_credit_sale"
    RECORD_CUSTOMER_PAYMENT = "record_customer_payment"
    CUSTOMER_BALANCE_QUERY = "customer_balance_query"
    CUSTOMER_LEDGER_QUERY = "customer_ledger_query"
    CORRECT_TRANSACTION = "correct_transaction"
    DELETE_OR_REVERSE_RECORD = "delete_or_reverse_record"
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
    confirmation_requested: bool = False


_NUMERAL_TRANSLATION = str.maketrans("०१२३४५६७८९", "0123456789")
_NUMBER_WORDS = {
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "एक": "1",
    "दो": "2",
    "तीन": "3",
    "चार": "4",
    "पाँच": "5",
    "पांच": "5",
    "छह": "6",
    "सात": "7",
    "आठ": "8",
    "नौ": "9",
    "दस": "10",
}
_QUANTITY = re.compile(
    r"(?<!\w)(\d+(?:\.\d{1,3})?|"
    + "|".join(re.escape(word) for word in _NUMBER_WORDS)
    + r")(?!\w)",
    re.I,
)
_AMOUNT = re.compile(
    r"(?<!\w)(\d+(?:\.\d{1,2})?)\s*(?:₹|rs\.?|rupees?|rupaye|rupay|रुप(?:ये|ए)?)(?!\w)",
    re.I,
)
_PRICE = re.compile(r"\b(?:selling price|price|daam)\s*(?:is|of)?\s*(\d+(?:\.\d{1,2})?)", re.I)
_UNIT_WORDS = {
    "packet", "packets", "pkt", "pkts", "piece", "pieces", "pcs",
    "unit", "units", "bottle", "bottles", "kg", "kgs", "kilogram", "kilograms",
    "gram", "grams", "g", "litre", "litres", "liter", "liters", "लिटर", "किलो",
    "पैकेट", "पैकेट्स", "पीस",
}
_RECEIPT_PHRASES = (
    "receive", "received", "bought", "buy", "purchase", "purchased",
    "kharida", "kharide", "khareeda", "khareede", "kharidi",
    "maal aaya", "maal aayi", "put in stock", "put into stock",
    "stock mein daal do", "stock me daal do", "stock mein jod do", "stock me jod do",
    "माल आया", "माल आई", "खरीदा", "खरीदे", "खरीदी", "स्टॉक में डालो",
    "स्टॉक में जोड़ो", "स्टॉक में जोड़ दो",
)
_SALE_PHRASES = (
    "sell", "sold", "sale ho gaya", "sale ho gya", "bik gaya", "bik gaye",
    "bech do", "becha", "बेच", "बिक गया", "बिक गए", "बेचा",
)
_ENTITY_NOISE = (
    "stock mein add karo", "stock me add karo", "stock mein daal do", "stock me daal do",
    "stock mein jod do", "stock me jod do", "put in stock", "put into stock",
    "to inventory", "in inventory",
    "to the inventory", "into inventory", "to stock", "in stock", "into stock",
    "stock mein", "stock me", "inventory", "stock", "add stock", "add to stock",
    "add to inventory", "add", "receive", "received", "bought", "buy", "purchase",
    "purchased", "kharida", "kharide", "khareeda", "khareede", "kharidi",
    "maal aaya", "maal aayi", "माल आया", "माल आई", "खरीदा", "खरीदे", "खरीदी",
    "स्टॉक में डालो", "स्टॉक में जोड़ो", "स्टॉक में जोड़ दो", "डाल दो", "जोड़ो", "जोड़ दो",
    "sale ho gaya", "sale ho gya", "bik gaya", "bik gaye", "bech do", "becha",
    "sell", "sold", "बेच", "बिक गया", "बिक गए", "बेचा",
    "kar do", "kardo", "karo", "do", "hai", "hain", "tha", "thi", "the",
    "maine", "main", "i", "we", "have", "has", "of", "to", "the",
    "packet", "packets", "pkt", "pkts", "piece", "pieces", "pcs", "unit", "units",
    "bottle", "bottles", "kg", "kgs", "kilogram", "kilograms", "gram", "grams",
    "g", "litre", "litres", "liter", "liters", "ke", "ka", "ki", "ko", "ne",
    "de diye", "de diya", "diya", "udhar diya", "का", "के", "की", "को", "ने",
    "से", "में", "दे दिए", "दे दिया", "दिए", "दिया", "उधार दिया", "पैकेट",
    "पैकेट्स", "पीस",
)
_ADD_RECEIPT_CONTEXT = ("stock", "inventory", "maal", "सामान", "स्टॉक", "इन्वेंटरी")


def _find_unit(text: str) -> str | None:
    explicit = re.search(r"\bunit\s+([a-z]+)\b", text)
    if explicit and explicit.group(1) in _UNIT_WORDS:
        return explicit.group(1)
    matches = [
        (match.start(), -len(unit), unit)
        for unit in _UNIT_WORDS
        if (match := re.search(rf"(?<!\w){re.escape(unit)}(?!\w)", text))
    ]
    return min(matches)[2] if matches else None


def _number(text: str, pattern: re.Pattern[str]) -> tuple[Decimal | None, str]:
    match = pattern.search(text)
    if match is None:
        return None, text
    number = _NUMBER_WORDS.get(match.group(1).casefold(), match.group(1))
    return Decimal(number), text[:match.start()] + " " + text[match.end():]


def _clean_entity(text: str) -> str | None:
    value = normalize_text(text.translate(_NUMERAL_TRANSLATION))
    for phrase in sorted(_ENTITY_NOISE, key=len, reverse=True):
        value = re.sub(rf"(?<!\w){re.escape(normalize_text(phrase))}(?!\w)", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" .,!?-")
    return value or None


def is_action_like_request(text: str) -> bool:
    normalized = normalize_text(text.translate(_NUMERAL_TRANSLATION))
    if normalized.startswith(("what if ", "can i sell ", "could i sell ", "should i sell ", "would i sell ")):
        return False
    return any(normalize_text(phrase) in normalized for phrase in (*_RECEIPT_PHRASES, *_SALE_PHRASES)) or (
        re.search(r"(?<!\w)(?:add|put|daal|daalo|jodo|jod)(?!\w)", normalized) is not None
        and any(normalize_text(context) in normalized for context in _ADD_RECEIPT_CONTEXT)
    )


def _extract_location(text: str) -> tuple[str, str | None]:
    match = re.search(r"\b(?:at|in|location)\s+(.+?)\s*$", text)
    if match:
        location = re.sub(r"\s+(?:add kar do|kardo|kar do|add stock|stock add|receive)$", "", match.group(1))
        return text[:match.start()], _clean_entity(location)
    return text, None


def interpret_command(text: str) -> BusinessCommand | None:
    """Parse only unambiguous, bounded common actions; unresolved fields require clarification."""
    normalized = normalize_text(text.translate(_NUMERAL_TRANSLATION))
    if not normalized:
        return None
    if any(phrase in normalized for phrase in ("delete", "remove", "undo", "reverse", "cancel", "हटा दो", "मिटा दो")):
        return BusinessCommand(intent=CommandIntent.DELETE_OR_REVERSE_RECORD)
    if any(phrase in normalized for phrase in ("correct transaction", "wrong entry", "galat entry", "सुधार")):
        return BusinessCommand(intent=CommandIntent.CORRECT_TRANSACTION)

    if any(word in normalized for word in ("pending", "balance", "kitna udhar", "कितना उधार")):
        customer = re.split(r"(?<!\w)(?:ka|ki|ke|का|की|के)(?!\w)", normalized, maxsplit=1)[0]
        customer = _clean_entity(re.sub(r"\b(?:kitna udhar pending|kitna udhar|pending|balance)\b", " ", customer))
        return BusinessCommand(intent=CommandIntent.CUSTOMER_BALANCE_QUERY, customer_query=customer)
    if any(word in normalized for word in ("ledger", "transaction history", "hisab", "खाता")):
        customer = _clean_entity(re.sub(r"(?<!\w)(?:show|view|dikhao|का|की|के|ledger|hisab|खाता)(?!\w)", " ", normalized))
        return BusinessCommand(intent=CommandIntent.CUSTOMER_LEDGER_QUERY, customer_query=customer)

    if any(phrase in normalized for phrase in ("de diye", "paid", "payment received", "jama kar", "दे दिए", "भुगतान")):
        amount, residue = _number(normalized, _AMOUNT)
        customer = _clean_entity(re.sub(r"(?<!\w)(?:ne|de diye|paid|payment received|jama kar|customer|ने|दे दिए|दे दिया|भुगतान)(?!\w)", " ", residue))
        return BusinessCommand(
            intent=CommandIntent.RECORD_CUSTOMER_PAYMENT,
            customer_query=customer,
            amount=amount,
        )

    if any(phrase in normalized for phrase in ("udhar diya", "credit sale", "on credit", "उधार दिया")):
        amount, residue = _number(normalized, _AMOUNT)
        customer = _clean_entity(re.sub(r"(?<!\w)(?:ko|ka|udhar diya|credit sale|on credit|को|का|उधार दिया)(?!\w)", " ", residue))
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

    if any(phrase in normalized for phrase in ("new product", "create product", "naya product", "नया उत्पाद")):
        text_without_prefix = re.sub(r"^(?:new product|create product|naya product|नया उत्पाद)\s*", "", normalized)
        quantity, residue = _number(text_without_prefix, _QUANTITY)
        sale_price, residue = _number(residue, _PRICE)
        residue, location = _extract_location(residue)
        product = _clean_entity(re.sub(r"\b(?:quantity|qty|unit|selling|price|daam|add|kar do|kardo)\b", " ", residue))
        unit_match = _find_unit(normalized)
        return BusinessCommand(
            intent=CommandIntent.CREATE_PRODUCT,
            product_query=product,
            quantity=quantity,
            unit=unit_match,
            sale_price=sale_price,
            location_query=location,
        )

    if "price" in normalized or "daam" in normalized or "कीमत" in normalized:
        amount, residue = _number(normalized, _QUANTITY)
        product = _clean_entity(re.sub(r"(?<!\w)(?:ka|ki|ke|price|daam|kar do|kardo|set|to|कीमत)(?!\w)", " ", residue))
        return BusinessCommand(
            intent=CommandIntent.UPDATE_PRODUCT,
            product_query=product,
            sale_price=amount,
        )

    if normalized.startswith("what if ") or re.search(
        r"\b(?:can|could|should|would|will|might|may|want|plan|planning)\b.{0,40}\b(?:sell|sold|bech|बेच)\b",
        normalized,
    ):
        return None

    if any(normalize_text(phrase) in normalized for phrase in _SALE_PHRASES):
        quantity, residue = _number(normalized, _QUANTITY)
        residue, location = _extract_location(residue)
        product = _clean_entity(residue)
        unit = _find_unit(normalized)
        return BusinessCommand(
            intent=CommandIntent.RECORD_SALE,
            product_query=product,
            quantity=quantity,
            unit=unit,
            location_query=location,
        )

    has_receipt_phrase = any(normalize_text(phrase) in normalized for phrase in _RECEIPT_PHRASES)
    has_contextual_add = (
        re.search(r"(?<!\w)(?:add|put|daal|daalo|jodo|jod)(?!\w)", normalized) is not None
        and (
            any(normalize_text(context) in normalized for context in _ADD_RECEIPT_CONTEXT)
            or any(re.search(rf"(?<!\w){re.escape(unit)}(?!\w)", normalized) for unit in _UNIT_WORDS)
        )
    )
    if has_receipt_phrase or has_contextual_add:
        quantity, residue = _number(normalized, _QUANTITY)
        residue, location = _extract_location(residue)
        product = _clean_entity(residue)
        unit = _find_unit(normalized)
        return BusinessCommand(
            intent=CommandIntent.RECEIVE_STOCK,
            product_query=product,
            quantity=quantity,
            unit=unit,
            location_query=location,
        )
    return None
