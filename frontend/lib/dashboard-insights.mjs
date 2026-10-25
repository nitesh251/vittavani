function formatCurrency(amount, currency) {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

function movementInsight(movement, timeZone) {
  const date = new Date(movement.created_at);
  let dateLabel = "";
  if (!Number.isNaN(date.getTime())) {
    try {
      dateLabel = ` on ${new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeZone,
      }).format(date)}`;
    } catch {
      dateLabel = ` on ${date.toLocaleDateString("en-IN", { dateStyle: "medium" })}`;
    }
  }
  if (movement.movement_type === "purchase_receipt") {
    return {
      title: "Stock receipt recorded",
      detail: `${movement.display_quantity} of ${movement.product_name} was received${dateLabel}.`,
      action: "View stock movements",
      href: "#stock-movements",
      icon: "↓",
      tone: "cyan",
    };
  }
  if (movement.movement_type === "sale") {
    return {
      title: "Sale recorded",
      detail: `${movement.display_quantity} of ${movement.product_name} was recorded as sold${dateLabel}.`,
      action: "View sales history",
      href: "#sales",
      icon: "↗",
      tone: "blue",
    };
  }
  return null;
}

export function getDashboardInsightsState({ loading, error, dashboard }) {
  if (loading) return { status: "loading", insights: [] };
  if (error || !dashboard) return { status: "error", insights: [] };

  const insights = [];
  const sales = dashboard.sales_overview;
  const current = sales?.current_period;
  const previous = sales?.previous_period;

  if (current?.sale_count > 0 && previous?.sale_count > 0) {
    const currentAmount = Number(current.total_amount);
    const previousAmount = Number(previous.total_amount);
    const direction = currentAmount - previousAmount;
    insights.push({
      title: direction > 0
        ? "Recorded sales increased"
        : direction < 0
          ? "Recorded sales decreased"
          : "Recorded sales were unchanged",
      detail: `The last seven days totalled ${formatCurrency(current.total_amount, sales.currency)}, compared with ${formatCurrency(previous.total_amount, sales.currency)} in the previous seven days.`,
      action: "View sales history",
      href: "#sales",
      icon: "↗",
      tone: "blue",
    });
  } else if (current?.sale_count > 0) {
    insights.push({
      title: "Sales recorded this week",
      detail: `${current.sale_count} sales totalling ${formatCurrency(current.total_amount, sales.currency)} were recorded in the last seven days.`,
      action: "View sales history",
      href: "#sales",
      icon: "↗",
      tone: "blue",
    });
  }

  const topProduct = sales?.top_products?.[0];
  if (topProduct) {
    insights.push({
      title: "Top-selling product · 7 days",
      detail: `${topProduct.name} led recorded quantity with ${topProduct.quantity} ${topProduct.unit} sold.`,
      action: "View sales history",
      href: "#sales",
      icon: "★",
      tone: "cyan",
    });
  }

  const lowStock = dashboard.low_stock_products?.[0];
  if (lowStock) {
    insights.push({
      title: "Review stock levels",
      detail: `${lowStock.name} has ${lowStock.display_quantity} available against a minimum of ${lowStock.display_minimum_stock}.`,
      action: "Review inventory",
      href: "#inventory",
      icon: "!",
      tone: "amber",
    });
  } else if (dashboard.out_of_stock_count > 0) {
    insights.push({
      title: "Products out of stock",
      detail: `${dashboard.out_of_stock_count} tracked ${dashboard.out_of_stock_count === 1 ? "product has" : "products have"} no stock on hand.`,
      action: "Review inventory",
      href: "#inventory",
      icon: "!",
      tone: "amber",
    });
  }

  const recentMovement = dashboard.recent_stock_activity
    ?.map((movement) => movementInsight(movement, sales?.timezone))
    .find(Boolean);
  if (recentMovement) insights.push(recentMovement);

  if (dashboard.product_count > 0 && !lowStock) {
    const onHand = dashboard.stock_by_unit?.map((item) => item.display_quantity).filter(Boolean) ?? [];
    insights.push({
      title: "Inventory on hand",
      detail: onHand.length
        ? `${dashboard.product_count} products are tracked, with ${onHand.join(" and ")} currently on hand.`
        : `${dashboard.product_count} products are tracked, but no stock is currently recorded on hand.`,
      action: "Review inventory",
      href: "#inventory",
      icon: "▦",
      tone: "cyan",
    });
  }

  if (insights.length) return { status: "ready", insights: insights.slice(0, 3) };
  return { status: "empty", insights: [] };
}
