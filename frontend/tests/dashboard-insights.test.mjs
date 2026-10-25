import assert from "node:assert/strict";
import test from "node:test";

import { getDashboardInsightsState } from "../lib/dashboard-insights.mjs";

function dashboard(overrides = {}) {
  return {
    product_count: 0,
    stock_by_unit: [],
    low_stock_products: [],
    recent_stock_activity: [],
    sales_overview: {
      currency: "INR",
      current_period: { sale_count: 0, total_amount: "0.00" },
      previous_period: { sale_count: 0, total_amount: "0.00" },
      top_products: [],
    },
    ...overrides,
  };
}

test("inventory without sales still produces a persisted-stock insight", () => {
  const state = getDashboardInsightsState({
    dashboard: dashboard({
      product_count: 2,
      stock_by_unit: [{ unit: "packet", display_quantity: "23 packets" }],
    }),
  });

  assert.equal(state.status, "ready");
  assert.match(state.insights[0].detail, /2 products are tracked/);
  assert.match(state.insights[0].detail, /23 packets/);
});

test("sales and recent movements produce concise, data-backed insights", () => {
  const state = getDashboardInsightsState({
    dashboard: dashboard({
      sales_overview: {
        currency: "INR",
        current_period: { sale_count: 2, total_amount: "500.00" },
        previous_period: { sale_count: 1, total_amount: "250.00" },
        top_products: [{ name: "Keyboard", quantity: "3", unit: "pieces" }],
      },
      recent_stock_activity: [{
        movement_type: "purchase_receipt",
        product_name: "Mouse",
        display_quantity: "4 pieces",
      }],
    }),
  });

  assert.equal(state.status, "ready");
  assert.equal(state.insights.length, 3);
  assert.match(state.insights[0].detail, /₹500\.00/);
  assert.match(state.insights[1].detail, /3 pieces sold/);
  assert.match(state.insights[2].detail, /4 pieces of Mouse was received/);
});

test("insufficient sales periods are not presented as a comparison", () => {
  const state = getDashboardInsightsState({
    dashboard: dashboard({
      sales_overview: {
        currency: "INR",
        current_period: { sale_count: 1, total_amount: "90.00" },
        previous_period: { sale_count: 0, total_amount: "0.00" },
        top_products: [],
      },
    }),
  });

  assert.equal(state.status, "ready");
  assert.equal(state.insights[0].title, "Sales recorded this week");
  assert.doesNotMatch(state.insights[0].detail, /compared with/);
});

test("no records suggests a useful first action instead of fabricating insight", () => {
  const state = getDashboardInsightsState({ dashboard: dashboard() });

  assert.equal(state.status, "empty");
  assert.deepEqual(state.insights, []);
});

test("loading and failed dashboard requests are distinct from an empty business", () => {
  assert.equal(getDashboardInsightsState({ loading: true }).status, "loading");
  assert.equal(getDashboardInsightsState({ error: "request failed" }).status, "error");
});
