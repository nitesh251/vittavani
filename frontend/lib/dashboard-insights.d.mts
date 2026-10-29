export type DashboardInsight = {
  title: string;
  detail: string;
  action: string;
  href: string;
  icon: string;
  tone: "blue" | "cyan" | "amber";
};

export type DashboardInsightsState = {
  status: "loading" | "error" | "empty" | "ready";
  insights: DashboardInsight[];
};

export function getDashboardInsightsState(input: {
  loading?: boolean;
  error?: string;
  dashboard?: {
    product_count: number;
    out_of_stock_count?: number;
    stock_by_unit?: { display_quantity: string }[];
    low_stock_products?: {
      name: string;
      display_quantity: string;
      display_minimum_stock: string;
    }[];
    recent_stock_activity?: {
      movement_type: string;
      product_name: string;
      display_quantity: string;
      created_at: string;
    }[];
    sales_overview?: {
      currency: string;
      timezone?: string;
      current_period: { sale_count: number; total_amount: string };
      previous_period: { sale_count: number; total_amount: string };
      top_products: { name: string; quantity: string; unit: string }[];
    };
  } | null;
}): DashboardInsightsState;
