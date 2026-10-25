from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.formatting import format_quantity
from app.inventory_metrics import inventory_totals_subquery
from app.models import (
    Business,
    CustomerLedgerEntry,
    Product,
    Sale,
    SaleLineItem,
)

_ZERO = Decimal("0")
_MONEY = Decimal("0.01")
_QUANTITY = Decimal("0.001")


def _business_zone(timezone_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name)
    except (ValueError, ZoneInfoNotFoundError):
        return ZoneInfo("Asia/Kolkata")


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def sales_overview(
    session: Session,
    business_id: UUID,
    timezone_name: str,
    *,
    now: datetime | None = None,
) -> dict[str, object]:
    zone = _business_zone(timezone_name)
    local_now = (now or datetime.now(UTC)).astimezone(zone)
    today = local_now.date()
    first_day = today - timedelta(days=6)
    previous_start = first_day - timedelta(days=7)
    start_at = datetime.combine(previous_start, time.min, tzinfo=zone).astimezone(UTC)
    end_at = datetime.combine(today + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC)

    sales = session.scalars(
        select(Sale)
        .where(
            Sale.business_id == business_id,
            Sale.created_at >= start_at,
            Sale.created_at < end_at,
        )
        .order_by(Sale.created_at, Sale.id)
    ).all()
    sales_by_id = {sale.id: sale for sale in sales}
    sale_ids = list(sales_by_id)

    daily_sales: dict[date, dict[str, object]] = {}
    for offset in range(14):
        day = previous_start + timedelta(days=offset)
        daily_sales[day] = {
            "amount": _ZERO,
            "sale_count": 0,
            "quantity_by_unit": {},
        }

    for sale in sales:
        sale_day = _as_utc(sale.created_at).astimezone(zone).date()
        summary = daily_sales[sale_day]
        summary["amount"] = summary["amount"] + sale.total_amount
        summary["sale_count"] += 1

    top_quantities: dict[tuple[UUID, str, str], Decimal] = {}
    if sale_ids:
        lines = session.execute(
            select(SaleLineItem, Product.name, Product.unit)
            .join(
                Sale,
                (Sale.business_id == SaleLineItem.business_id)
                & (Sale.id == SaleLineItem.sale_id),
            )
            .join(
                Product,
                (Product.business_id == SaleLineItem.business_id)
                & (Product.id == SaleLineItem.product_id),
            )
            .where(
                SaleLineItem.business_id == business_id,
                SaleLineItem.sale_id.in_(sale_ids),
            )
        ).all()
        for line, product_name, unit in lines:
            sale_day = _as_utc(sales_by_id[line.sale_id].created_at).astimezone(zone).date()
            quantities = daily_sales[sale_day]["quantity_by_unit"]
            quantities[unit] = quantities.get(unit, _ZERO) + line.quantity
            if sale_day >= first_day:
                key = (line.product_id, product_name, unit)
                top_quantities[key] = top_quantities.get(key, _ZERO) + line.quantity

    ledger_rows = session.execute(
        select(
            CustomerLedgerEntry.customer_id,
            func.sum(CustomerLedgerEntry.amount_delta),
        )
        .where(CustomerLedgerEntry.business_id == business_id)
        .group_by(CustomerLedgerEntry.customer_id)
    ).all()
    outstanding = sum((max(balance or _ZERO, _ZERO) for _, balance in ledger_rows), _ZERO)

    def amount_for(day: date) -> str:
        return str(daily_sales[day]["amount"].quantize(_MONEY, rounding=ROUND_HALF_UP))

    def trend_item(day: date) -> dict[str, object]:
        summary = daily_sales[day]
        quantities = summary["quantity_by_unit"]
        return {
            "date": day.isoformat(),
            "total_amount": amount_for(day),
            "sale_count": summary["sale_count"],
            "quantity_by_unit": [
                {"unit": unit, "quantity": format_quantity(quantity)}
                for unit, quantity in sorted(quantities.items())
            ],
        }

    business = session.get(Business, business_id)
    current_sales = [daily_sales[first_day + timedelta(days=i)] for i in range(7)]
    earlier_sales = [daily_sales[previous_start + timedelta(days=i)] for i in range(7)]
    current_amount = sum((item["amount"] for item in current_sales), _ZERO)
    earlier_amount = sum((item["amount"] for item in earlier_sales), _ZERO)
    current_count = sum(item["sale_count"] for item in current_sales)
    earlier_count = sum(item["sale_count"] for item in earlier_sales)
    today_summary = daily_sales[today]

    top_products = [
        {
            "product_id": str(product_id),
            "name": name,
            "quantity": format_quantity(quantity),
            "unit": unit,
        }
        for (product_id, name, unit), quantity in sorted(
            top_quantities.items(),
            key=lambda item: (-item[1], item[0][1].casefold()),
        )[:5]
    ]

    return {
        "currency": business.currency if business else "INR",
        "timezone": timezone_name,
        "today": {
            "total_amount": str(today_summary["amount"].quantize(_MONEY, rounding=ROUND_HALF_UP)),
            "sale_count": today_summary["sale_count"],
            "quantity_by_unit": [
                {"unit": unit, "quantity": format_quantity(quantity)}
                for unit, quantity in sorted(today_summary["quantity_by_unit"].items())
            ],
        },
        "trend": [trend_item(first_day + timedelta(days=i)) for i in range(7)],
        "top_products": top_products,
        "previous_period": {
            "total_amount": str(earlier_amount.quantize(_MONEY, rounding=ROUND_HALF_UP)),
            "sale_count": earlier_count,
        },
        "current_period": {
            "total_amount": str(current_amount.quantize(_MONEY, rounding=ROUND_HALF_UP)),
            "sale_count": current_count,
        },
        "pending_customer_balances": str(outstanding.quantize(_MONEY, rounding=ROUND_HALF_UP)),
        "sales_status_note": "Sales records represent recorded sales; cancellations and refunds are not tracked.",
    }


def restock_candidates(
    session: Session,
    business_id: UUID,
    timezone_name: str,
    *,
    now: datetime | None = None,
) -> list[dict[str, str | None]]:
    zone = _business_zone(timezone_name)
    today = (now or datetime.now(UTC)).astimezone(zone).date()
    start_at = datetime.combine(today - timedelta(days=29), time.min, tzinfo=zone).astimezone(UTC)
    totals = inventory_totals_subquery(business_id)
    product_rows = session.execute(
        select(
            Product,
            func.coalesce(totals.c.quantity, _ZERO).label("available"),
        )
        .outerjoin(totals, totals.c.product_id == Product.id)
        .where(Product.business_id == business_id, Product.active.is_(True))
    ).all()
    recent_sales = dict(
        session.execute(
            select(SaleLineItem.product_id, func.sum(SaleLineItem.quantity))
            .join(
                Sale,
                (Sale.business_id == SaleLineItem.business_id)
                & (Sale.id == SaleLineItem.sale_id),
            )
            .where(
                Sale.business_id == business_id,
                Sale.created_at >= start_at,
                Sale.created_at < datetime.combine(today + timedelta(days=1), time.min, tzinfo=zone).astimezone(UTC),
            )
            .group_by(SaleLineItem.product_id)
        ).all()
    )

    candidates: list[tuple[bool, Decimal, dict[str, str | None]]] = []
    for product, available in product_rows:
        sold_quantity = recent_sales.get(product.id, _ZERO) or _ZERO
        daily_velocity = sold_quantity / Decimal(30)
        coverage_days = available / daily_velocity if daily_velocity > 0 else None
        at_or_below_minimum = available <= product.minimum_stock
        within_seven_days = coverage_days is not None and coverage_days <= 7
        if not at_or_below_minimum and not within_seven_days:
            continue
        candidates.append(
            (
                at_or_below_minimum,
                coverage_days if coverage_days is not None else Decimal("Infinity"),
                {
                    "name": product.name,
                    "unit": product.unit,
                    "available": str(available),
                    "minimum_stock": str(product.minimum_stock),
                    "sold_last_30_days": str(sold_quantity),
                    "daily_velocity": str(daily_velocity.quantize(_QUANTITY, rounding=ROUND_HALF_UP)),
                    "coverage_days": (
                        str(coverage_days.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
                        if coverage_days is not None
                        else None
                    ),
                },
            )
        )
    return [
        item
        for _, _, item in sorted(
            candidates,
            key=lambda candidate: (
                not candidate[0],
                candidate[1],
                candidate[2]["name"].casefold(),
            ),
        )[:5]
    ]


def previous_calendar_week_sales(
    session: Session,
    business_id: UUID,
    timezone_name: str,
    *,
    now: datetime | None = None,
) -> dict[str, object]:
    zone = _business_zone(timezone_name)
    today = (now or datetime.now(UTC)).astimezone(zone).date()
    this_week_start = today - timedelta(days=today.weekday())
    start_day = this_week_start - timedelta(days=7)
    end_day = this_week_start
    start_at = datetime.combine(start_day, time.min, tzinfo=zone).astimezone(UTC)
    end_at = datetime.combine(end_day, time.min, tzinfo=zone).astimezone(UTC)
    sales = session.scalars(
        select(Sale).where(
            Sale.business_id == business_id,
            Sale.created_at >= start_at,
            Sale.created_at < end_at,
        )
    ).all()
    quantities: dict[tuple[UUID, str, str], Decimal] = {}
    if sales:
        lines = session.execute(
            select(SaleLineItem, Product.name, Product.unit)
            .join(
                Sale,
                (Sale.business_id == SaleLineItem.business_id)
                & (Sale.id == SaleLineItem.sale_id),
            )
            .join(
                Product,
                (Product.business_id == SaleLineItem.business_id)
                & (Product.id == SaleLineItem.product_id),
            )
            .where(
                SaleLineItem.business_id == business_id,
                SaleLineItem.sale_id.in_([sale.id for sale in sales]),
            )
        ).all()
        for line, product_name, unit in lines:
            key = (line.product_id, product_name, unit)
            quantities[key] = quantities.get(key, _ZERO) + line.quantity
    top_products = [
        {
            "product_id": str(product_id),
            "name": name,
            "quantity": format_quantity(quantity),
            "unit": unit,
        }
        for (product_id, name, unit), quantity in sorted(
            quantities.items(),
            key=lambda item: (-item[1], item[0][1].casefold()),
        )[:5]
    ]
    business = session.get(Business, business_id)
    return {
        "period_start": start_day.isoformat(),
        "period_end": (end_day - timedelta(days=1)).isoformat(),
        "currency": business.currency if business else "INR",
        "total_amount": str(
            sum((sale.total_amount for sale in sales), _ZERO).quantize(
                _MONEY,
                rounding=ROUND_HALF_UP,
            )
        ),
        "sale_count": len(sales),
        "top_products": top_products,
    }


def classify_business_question(question: str) -> str | None:
    text = " ".join(question.casefold().split())
    question_prefixes = (
        "how ",
        "what ",
        "which ",
        "show ",
        "list ",
        "tell me ",
        "did ",
        "aaj ",
        "आज ",
        "कितने ",
        "कितनी ",
        "कितना ",
        "कौन ",
    )
    is_question = text.startswith(question_prefixes) or text.endswith("?")
    top_question = any(word in text for word in ("top selling", "top-selling", "best selling", "most sold", "sold the most", "sabse zyada", "सबसे ज़्यादा"))
    if top_question and any(text.startswith(prefix) for prefix in ("which ", "what ", "show ", "list ", "top ", "kaun", "कौन")):
        return "last_week_top_products" if "last week" in text else "top_products"
    product_sales_question = (
        any(text.startswith(prefix) for prefix in ("which products", "what products", "show products", "list products", "कौन से उत्पाद"))
        and any(verb in text for verb in ("sell", "sold", "sale", "बिक"))
    )
    if product_sales_question and "last week" in text:
        return "last_week_top_products"
    mutation = (
        "record sale",
        "sell ",
        "create ",
        "add ",
        "receive ",
        "transfer ",
        "delete ",
        "update ",
        "bik gaya",
        "bik gayi",
        "bech do",
        "jod do",
        "jodna",
        "stock add",
        "stock receive",
    )
    if any(phrase in text for phrase in mutation if phrase != "sell ") or (
        "sell " in text and not is_question
    ):
        return None
    if "sold " in text and not is_question:
        return None
    is_last_week = "last week" in text
    if is_last_week and (
        top_question
        or product_sales_question
        or any(word in text for word in ("sales", "sale", "revenue", "bikri", "बिक्री"))
    ):
        return "last_week_top_products" if top_question or product_sales_question else "last_week"
    if any(word in text for word in ("restock", "replenish", "what should i order", "kya mangaye", "stock bhar")):
        return "restock"
    if any(word in text for word in ("improve sales", "increase sales", "grow sales", "boost sales", "sales badha", "bikri badha", "बिक्री बढ़")):
        return "improve"
    if any(word in text for word in ("why sales drop", "sales drop", "sales dropped", "sales down", "sales decline", "sales trend", "sales compare", "sales performance", "business performance", "how is my business doing", "bikri kam", "बिक्री कम", "girawat")):
        return "trend"
    has_sales = any(word in text for word in ("sales", "sale", "revenue", "bikri", "बिक्री")) or (
        is_question and any(word in text for word in ("sold ", "sell "))
    )
    has_period = any(word in text for word in ("today", "aaj", "आज", "this week", "last week", "week", "recent"))
    if has_sales and has_period:
        return "trend" if any(word in text for word in ("week", "recent", "trend", "compare")) else "today"
    if top_question or product_sales_question:
        return "top_products"
    return None


def answer_business_question(
    session: Session,
    business_id: UUID,
    timezone_name: str,
    question: str,
    *,
    now: datetime | None = None,
) -> tuple[str, dict[str, object]] | None:
    intent = classify_business_question(question)
    if intent is None:
        return None
    if intent in {"last_week", "last_week_top_products"}:
        report = previous_calendar_week_sales(session, business_id, timezone_name, now=now)
        period = f'{report["period_start"]} to {report["period_end"]} ({timezone_name})'
        if report["sale_count"] == 0:
            message = f"There are no recorded sales for the last local calendar week ({period})."
        elif intent == "last_week_top_products":
            products = report["top_products"]
            ranked = "; ".join(
                f'{index}. {item["name"]}: {item["quantity"]} {item["unit"]}'
                for index, item in enumerate(products, 1)
            )
            message = (
                f"Top products by recorded quantity last week ({period}): {ranked}."
                if ranked
                else f"No product quantities were recorded for last week ({period})."
            )
        else:
            message = (
                f'Recorded sales last local calendar week ({period}) totaled '
                f'{report["currency"]} '
                f'{report["total_amount"]} across {report["sale_count"]} sale(s).'
            )
        return message, {"intent": intent, **report}
    overview = sales_overview(session, business_id, timezone_name, now=now)
    currency = overview["currency"]
    today = overview["today"]
    current = overview["current_period"]
    previous = overview["previous_period"]

    if intent == "today":
        quantity_summary = today["quantity_by_unit"]
        quantities = ", ".join(
            f'{item["quantity"]} {item["unit"]}' for item in quantity_summary
        ) or "no recorded quantities"
        message = (
            f'Today ({timezone_name}): recorded sales total {currency} {today["total_amount"]} '
            f'across {today["sale_count"]} sale(s), with {quantities}. '
            f'{overview["sales_status_note"]}'
        )
        return message, {"intent": intent, "sales": overview["today"]}

    if intent == "top_products":
        products = overview["top_products"]
        if products:
            ranked = "; ".join(
                f'{index}. {item["name"]}: {item["quantity"]} {item["unit"]}'
                for index, item in enumerate(products, 1)
            )
            message = f"Top products by recorded quantity over the last 7 days: {ranked}."
        else:
            message = "There are no recorded sales in the last 7 days, so there is not enough data to rank products."
        return message, {"intent": intent, "period_days": 7, "top_products": products}

    if intent == "trend":
        delta = Decimal(current["total_amount"]) - Decimal(previous["total_amount"])
        direction = "higher" if delta > 0 else "lower" if delta < 0 else "unchanged"
        message = (
            f'Recorded sales for the last 7 days are {currency} {current["total_amount"]} '
            f'across {current["sale_count"]} sale(s), {direction} than the preceding 7 days '
            f'({currency} {previous["total_amount"]}, {previous["sale_count"]} sale(s)). '
            "This describes the recorded change only; the available records do not establish its cause."
        )
        if current["sale_count"] == 0 and previous["sale_count"] == 0:
            message = "There are no recorded sales in these 14 days, so there is not enough history to compare periods."
        return message, {
            "intent": intent,
            "current_period": current,
            "previous_period": previous,
            "daily_trend": overview["trend"],
        }

    if intent == "restock":
        candidates = restock_candidates(session, business_id, timezone_name, now=now)
        if candidates:
            details = []
            for item in candidates:
                evidence = (
                    f'{item["name"]}: {item["available"]} {item["unit"]} available '
                    f'(minimum {item["minimum_stock"]})'
                )
                if item["coverage_days"] is not None:
                    evidence += f', about {item["coverage_days"]} days of cover at its 30-day sales rate'
                details.append(evidence)
            message = (
                "Restock candidates based on configured minimums or an estimated 7-day coverage threshold: "
                + "; ".join(details)
                + ". Coverage is an estimate from recorded sales, not a forecast."
            )
        else:
            message = "No active products are at/below their configured minimum or estimated to have 7 days or less of stock cover."
        return message, {"intent": intent, "restock_candidates": candidates, "target_coverage_days": 7}

    top_products = overview["top_products"]
    candidates = restock_candidates(session, business_id, timezone_name, now=now)
    facts = []
    if int(current["sale_count"]) or int(previous["sale_count"]):
        facts.append(
            f'recorded sales were {currency} {current["total_amount"]} over the last 7 days '
            f'and {currency} {previous["total_amount"]} over the preceding 7 days'
        )
    if top_products:
        facts.append(
            f'{top_products[0]["name"]} led recorded quantity over the last 7 days '
            f'({top_products[0]["quantity"]} {top_products[0]["unit"]})'
        )
    if candidates:
        facts.append(
            "restock review is suggested for "
            + ", ".join(item["name"] for item in candidates[:3])
            + " based on stock thresholds or estimated coverage"
        )
    fact_summary = "Available records show " + "; ".join(facts) + ". " if facts else (
        "There is not enough recorded sales history yet to make business-specific recommendations. "
    )
    message = (
        fact_summary
        + "General ideas (not verified facts): review the products customers ask for, keep best sellers visible, "
        "and record sales consistently so future comparisons are more useful."
    )
    return message, {
        "intent": intent,
        "current_period": current,
        "previous_period": previous,
        "top_products": top_products,
        "restock_candidates": candidates,
        "recommendations_are_general": True,
    }
