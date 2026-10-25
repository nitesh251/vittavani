"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compareDecimalStrings } from "../lib/quantity.mjs";
import {
  getDisplayName,
  getProfileImageUrl,
  getProfileInitials,
  getTimeGreeting,
  type ProfileIdentity,
} from "../lib/profile.mjs";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
type Answer = {
  message: string;
  original_query: string;
  clarification_required: boolean;
  candidates: string[];
  intent?: string;
  action_result?: Record<string, unknown> | null;
};

type Dashboard = {
  product_count: number;
  total_stock_units: string | null;
  stock_by_unit: { unit: string; quantity: string; display_quantity: string }[];
  low_stock_count: number;
  out_of_stock_count: number;
  low_stock_products: { id: string; name: string; quantity: string; unit: string; minimum_stock: string; display_quantity: string; display_minimum_stock: string }[];
  stock_by_location: { id: string; name: string; product_count: number; stock_by_unit: { unit: string; quantity: string; display_quantity: string }[] }[];
  recent_stock_activity: {
    id: string;
    movement_type: string;
    product_name: string;
    quantity: string;
    unit: string;
    display_quantity: string;
    source_location: string | null;
    destination_location: string | null;
    created_at: string;
  }[];
  sales_overview: SalesOverview;
};

type SalesQuantity = { unit: string; quantity: string };
type SalesPeriod = { total_amount: string; sale_count: number };
type SalesOverview = {
  currency: string;
  timezone: string;
  today: SalesPeriod & { quantity_by_unit: SalesQuantity[] };
  trend: (SalesPeriod & { date: string; quantity_by_unit: SalesQuantity[] })[];
  top_products: { product_id: string; name: string; quantity: string; unit: string }[];
  previous_period: SalesPeriod;
  current_period: SalesPeriod;
  pending_customer_balances: string;
  sales_status_note: string;
};

type StockMovement = {
  id: string;
  product_name: string;
  movement_type: string;
  quantity: string;
  display_quantity: string;
  unit: string;
  source_location: string | null;
  destination_location: string | null;
  note: string | null;
  created_at: string;
};

type AssistantMode = "normal" | "ai";

type InventoryProduct = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  selling_price: string;
  minimum_stock: string;
  active: boolean;
  stock_status: "in_stock" | "low_stock" | "out_of_stock" | "inactive";
  aliases: string[];
  quantity: string;
  display_quantity: string;
  display_minimum_stock: string;
  balances: { location_id: string; location_name: string; quantity: string; display_quantity: string }[];
};

type InventoryLocation = { id: string; name: string; full_name: string; parent_location_id: string | null };
type Customer = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  outstanding_balance: string;
  created_at: string;
};
type CustomerLedgerItem = {
  id: string;
  transaction_type: string;
  amount_delta: string;
  outstanding_balance: string;
  sale_id: string | null;
  note: string | null;
  created_at: string;
};
type SaleHistoryItem = {
  id: string;
  product_name: string;
  quantity: string;
  unit: string;
  total_amount: string;
  paid_amount: string;
  customer_name: string | null;
  created_at: string;
};

type SpeechRecognitionAlternative = { transcript: string };
type SpeechRecognitionResult = ArrayLike<SpeechRecognitionAlternative> & { isFinal: boolean };
type SpeechRecognitionEvent = { resultIndex: number; results: ArrayLike<SpeechRecognitionResult> };
type SpeechRecognitionErrorEvent = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const examples = [
  "How much stock is left for Amul Butter?",
  "Amul butter kahan rakha hai?",
  "अमूल बटर कितना बचा है?",
  "Show my low-stock products.",
  "How much were sales today?",
  "Which products sold the most this week?",
  "What should I restock?",
];
const stockStatusLabels = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
  inactive: "Inactive",
};
const navigationItems = [
  { section: "dashboard", label: "Dashboard", icon: "▦" },
  { section: "sales", label: "Sales", icon: "↗" },
  { section: "inventory", label: "Inventory", icon: "▤" },
  { section: "customers", label: "Customers & Accounts", icon: "♙" },
  { label: "Payments & Collections", icon: "↔", reason: "Payment workflows are not implemented." },
  { label: "Purchases", icon: "▣", reason: "Purchasing workflows are not implemented." },
  { label: "Expenses", icon: "◷", reason: "Expense workflows are not implemented." },
  { section: "locations", label: "Locations", icon: "⌂" },
  { label: "Reports", icon: "▥", reason: "Financial reporting is not implemented." },
  { section: "ask", label: "Ask Vittavani", icon: "✦" },
  { label: "Settings", icon: "⚙", reason: "Account settings are not implemented." },
  { section: "stock-movements", label: "Stock movements", icon: "↕" },
] as const;
const headers = { "Content-Type": "application/json" };
const emptyProductForm = {
  name: "",
  sku: "",
  unit: "packet",
  selling_price: "0",
  minimum_stock: "0",
  aliases: "",
  active: true,
};

async function apiError(response: Response, defaultMessage: string): Promise<string> {
  if (response.status === 401) {
    return "API authentication failed. Check that DEV_API_TOKEN in the repository-root .env matches the token in frontend/.env.local, then restart both the API and Next.js.";
  }
  return response
    .clone()
    .json()
    .then((data: { detail?: string }) => data.detail ?? defaultMessage)
    .catch(() => defaultMessage);
}

function movementLabel(value: string) {
  return value.replaceAll("_", " ");
}

function movementPresentation(value: string) {
  if (value.startsWith("transfer")) return { kind: "transfer", icon: "⇄" };
  if (value === "purchase_receipt") return { kind: "received", icon: "＋" };
  return { kind: "adjustment", icon: "↕" };
}

function productBalanceSummary(
  product: InventoryProduct,
  locationNames: Map<string, string>,
) {
  return product.balances.length
    ? product.balances
        .map((balance) => `${locationNames.get(balance.location_id) ?? balance.location_name}: ${balance.display_quantity}`)
        .join(" · ")
    : "No location balance";
}

function productDetails(product: InventoryProduct, locationNames: Map<string, string>) {
  const sku = product.sku ? `SKU ${product.sku}` : "";
  return [
    sku,
    `Selling price ₹${product.selling_price}`,
    `Minimum ${product.display_minimum_stock}`,
    productBalanceSummary(product, locationNames),
  ].filter(Boolean).join(" · ");
}

function formatCurrency(amount: string, currency: string) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${currency} ${amount}`;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${amount}`;
  }
}

function Metric({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: string;
  tone: "cyan" | "blue" | "purple" | "orange";
}) {
  return (
    <article className={`metric metric-${tone}`}>
      <div className="metric-topline">
        <span className="metric-icon" aria-hidden="true">{icon}</span>
        <span className="metric-label">{label}</span>
      </div>
      <p className="metric-value">{value}</p>
      <p className="metric-detail">{detail}</p>
    </article>
  );
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState("");
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerLedger, setCustomerLedger] = useState<CustomerLedgerItem[]>([]);
  const [salesHistory, setSalesHistory] = useState<SaleHistoryItem[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerLoading, setCustomerLoading] = useState(true);
  const [customerError, setCustomerError] = useState("");
  const [customerNotice, setCustomerNotice] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerEditingId, setCustomerEditingId] = useState("");
  const [customerForm, setCustomerForm] = useState({ name: "", phone: "", address: "", notes: "" });
  const [customerPayment, setCustomerPayment] = useState("");
  const [customerSale, setCustomerSale] = useState({ product_id: "", location_id: "", quantity: "", paid_amount: "0" });
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiStatusError, setAiStatusError] = useState("");
  const [aiProvider, setAiProvider] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("normal");
  const [activeSection, setActiveSection] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileUser, setProfileUser] = useState<ProfileIdentity | null>(null);
  const [businessProfile, setBusinessProfile] = useState<{ name: string; timezone: string } | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const businessProfileUserIdRef = useRef<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productStatusFilter, setProductStatusFilter] = useState("all");
  const [productSort, setProductSort] = useState("name");
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState("");
  const [movementLoading, setMovementLoading] = useState(true);
  const [movementError, setMovementError] = useState("");
  const [inventoryNotice, setInventoryNotice] = useState("");
  const [inventoryWriteError, setInventoryWriteError] = useState("");
  const [writing, setWriting] = useState(false);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [stockMode, setStockMode] = useState("receipt");
  const [stockForm, setStockForm] = useState({ product_id: "", location_id: "", source_location_id: "", destination_location_id: "", quantity: "", unit: "", note: "" });
  const [locationForm, setLocationForm] = useState({ name: "", parent_location_id: "" });
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [speechLanguage, setSpeechLanguage] = useState("hi-IN");
  const [speakAnswers, setSpeakAnswers] = useState(false);
  const [speechOutputSupported, setSpeechOutputSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const askInputRef = useRef<HTMLTextAreaElement>(null);
  const commandRequestKeyRef = useRef<{ query: string; key: string } | null>(null);
  const customerSaleKeyRef = useRef<string | null>(null);
  const customerPaymentKeyRef = useRef<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError("");
    try {
      const response = await fetch("/api/v1/dashboard", { headers });
      if (!response.ok) {
        throw new Error(await apiError(response, "Could not load inventory summary."));
      }
      setDashboard((await response.json()) as Dashboard);
    } catch (caught) {
      setDashboardError(caught instanceof Error ? caught.message : "Could not load inventory summary.");
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const loadAssistantStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/ai/status", { headers });
      if (!response.ok) throw new Error("Could not check AI availability.");
      const data = (await response.json()) as { configured: boolean; provider: string | null; model: string | null };
      setAiConfigured(data.configured);
      setAiProvider(data.provider ?? "");
      setAiModel(data.model ?? "");
      setAiStatusError("");
    } catch {
      setAiConfigured(false);
      setAiProvider("");
      setAiModel("");
      setAiStatusError("AI availability could not be checked. Normal Search remains available.");
    }
  }, []);

  const loadStockMovements = useCallback(async () => {
    setMovementLoading(true);
    setMovementError("");
    try {
      const response = await fetch("/api/v1/stock-movements?limit=100", { headers });
      if (!response.ok) {
        throw new Error(await apiError(response, "Could not load stock history."));
      }
      const data = (await response.json()) as { items: StockMovement[] };
      setStockMovements(data.items);
    } catch (caught) {
      setMovementError(caught instanceof Error ? caught.message : "Could not load stock history.");
    } finally {
      setMovementLoading(false);
    }
  }, []);

  const loadCustomers = useCallback(async () => {
    setCustomerLoading(true);
    setCustomerError("");
    try {
      const response = await fetch("/api/v1/customers", { headers });
      if (!response.ok) throw new Error(await apiError(response, "Could not load customers."));
      const data = (await response.json()) as { items: Customer[] };
      setCustomers(data.items);
      setSelectedCustomerId((current) => current || data.items[0]?.id || "");
    } catch (caught) {
      setCustomerError(caught instanceof Error ? caught.message : "Could not load customers.");
    } finally {
      setCustomerLoading(false);
    }
  }, []);

  const loadCustomerLedger = useCallback(async (customerId = selectedCustomerId) => {
    if (!customerId) {
      setCustomerLedger([]);
      return;
    }
    try {
      const response = await fetch(`/api/v1/customers/${customerId}/ledger`, { headers });
      if (!response.ok) throw new Error(await apiError(response, "Could not load customer ledger."));
      const data = (await response.json()) as { items: CustomerLedgerItem[] };
      setCustomerLedger(data.items);
    } catch (caught) {
      setCustomerError(caught instanceof Error ? caught.message : "Could not load customer ledger.");
    }
  }, [selectedCustomerId]);

  const loadSalesHistory = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/sales?limit=100", { headers });
      if (!response.ok) throw new Error(await apiError(response, "Could not load sales history."));
      const data = (await response.json()) as { items: SaleHistoryItem[] };
      setSalesHistory(data.items);
    } catch (caught) {
      setCustomerError(caught instanceof Error ? caught.message : "Could not load sales history.");
    }
  }, []);

  const loadInventory = useCallback(async () => {
    setInventoryLoading(true);
    setInventoryError("");
    try {
      const [productResponse, locationResponse] = await Promise.all([
        fetch("/api/v1/products", { headers }),
        fetch("/api/v1/locations", { headers }),
      ]);
      const failed = [productResponse, locationResponse].find((response) => !response.ok);
      if (failed) {
        throw new Error(await apiError(failed, "Could not load products and locations."));
      }
      const productData = (await productResponse.json()) as { items: InventoryProduct[] };
      const locationData = (await locationResponse.json()) as { items: InventoryLocation[] };
      setProducts(productData.items);
      setLocations(locationData.items);
      setStockForm((current) => {
        const selectedProduct = productData.items.find((product) => product.id === current.product_id && product.active)
          ?? productData.items.find((product) => product.active);
        const sourceId = current.source_location_id || locationData.items[0]?.id || "";
        return {
          ...current,
          product_id: selectedProduct?.id ?? "",
          unit: selectedProduct?.unit ?? "",
          location_id: current.location_id || locationData.items[0]?.id || "",
          source_location_id: sourceId,
          destination_location_id: current.destination_location_id || locationData.items.find((location) => location.id !== sourceId)?.id || "",
        };
      });
    } catch (caught) {
      setInventoryError(caught instanceof Error ? caught.message : "Could not load inventory.");
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      setSidebarCollapsed(window.localStorage.getItem("vittavani-sidebar-collapsed") === "true");
    } catch {
      setSidebarCollapsed(false);
    }
    void loadDashboard();
    void loadInventory();
    void loadStockMovements();
    void loadCustomers();
    void loadSalesHistory();
    void loadAssistantStatus();
    setSpeakAnswers(window.localStorage.getItem("vittavani-speak-answers") === "true");
    setSpeechOutputSupported(
      "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined",
    );
    return () => {
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, [loadAssistantStatus, loadDashboard, loadInventory, loadStockMovements, loadCustomers, loadSalesHistory]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    let active = true;
    const loadBusinessProfile = async () => {
      try {
        const response = await fetch("/api/v1/business", { cache: "no-store" });
        if (!response.ok) return;
        const business = (await response.json()) as { name?: string; timezone?: string };
        if (active && business.name) {
          setBusinessProfile({ name: business.name, timezone: business.timezone || "Asia/Kolkata" });
        }
      } catch {
        if (active) setBusinessProfile(null);
      }
    };
    const applySessionUser = (user: ProfileIdentity | null) => {
      setProfileUser(user);
      setProfileMenuOpen(false);
      if (!user) {
        businessProfileUserIdRef.current = null;
        setBusinessProfile(null);
        return;
      }
      const userKey = user.id ?? user.email ?? "authenticated-user";
      if (businessProfileUserIdRef.current !== userKey) {
        businessProfileUserIdRef.current = userKey;
        void loadBusinessProfile();
      }
    };
    void client.auth.getSession().then(({ data }) => {
      if (active) applySessionUser(data.session?.user ?? null);
    });
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (active) applySessionUser(session?.user ?? null);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const pageSections = new Set(["dashboard", "sales", "inventory", "customers", "locations", "stock-movements", "ask"]);
    const syncPageFromHash = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      const target = document.getElementById(hash);
      const section = target?.closest<HTMLElement>("[data-page-section]")?.dataset.pageSection ?? hash;
      setActiveSection(pageSections.has(section) ? section : "dashboard");
    };
    syncPageFromHash();
    window.addEventListener("hashchange", syncPageFromHash);
    return () => window.removeEventListener("hashchange", syncPageFromHash);
  }, []);

  useEffect(() => {
    const pageTitles: Record<string, string> = {
      dashboard: "Dashboard",
      sales: "Sales",
      inventory: "Inventory",
      customers: "Customers & Accounts",
      locations: "Locations",
      "stock-movements": "Stock movements",
      ask: "Ask Vittavani",
    };
    document.title = `${pageTitles[activeSection] ?? "Dashboard"} | Vittavani`;
  }, [activeSection]);

  useEffect(() => {
    void loadCustomerLedger();
  }, [loadCustomerLedger]);

  useEffect(() => {
    function closeMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileMenuOpen(false);
    }
    function closeMenuOnDesktop() {
      if (window.innerWidth > 850) setMobileMenuOpen(false);
    }
    window.addEventListener("keydown", closeMenuOnEscape);
    window.addEventListener("resize", closeMenuOnDesktop);
    return () => {
      window.removeEventListener("keydown", closeMenuOnEscape);
      window.removeEventListener("resize", closeMenuOnDesktop);
    };
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
        profileTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  async function signOut() {
    const client = getSupabaseBrowserClient();
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) {
      window.alert("Could not sign out. Please try again.");
      return;
    }
    window.location.assign("/");
  }

  function toggleSidebar() {
    const nextCollapsed = !sidebarCollapsed;
    setSidebarCollapsed(nextCollapsed);
    try {
      window.localStorage.setItem("vittavani-sidebar-collapsed", String(nextCollapsed));
    } catch {}
  }

  async function writeInventory(path: string, method: "POST" | "PUT", body: object, success: string) {
    setWriting(true);
    setInventoryNotice("");
    setInventoryWriteError("");
    try {
      const response = await fetch(path, { method, headers, body: JSON.stringify(body) });
      if (!response.ok) {
        throw new Error(await apiError(response, `Could not save inventory changes (${response.status}).`));
      }
      setInventoryNotice(success);
      const updates = [loadDashboard(), loadInventory()];
      if (path.startsWith("/api/v1/inventory/")) updates.push(loadStockMovements());
      await Promise.all(updates);
      return true;
    } catch (caught) {
      setInventoryWriteError(caught instanceof Error ? caught.message : "Could not save inventory changes.");
      return false;
    } finally {
      setWriting(false);
    }
  }

  function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      name: productForm.name,
      sku: productForm.sku || null,
      unit: productForm.unit,
      selling_price: productForm.selling_price,
      minimum_stock: productForm.minimum_stock,
      aliases: productForm.aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
      ...(editingProduct ? { active: productForm.active } : {}),
    };
    const path = editingProduct ? `/api/v1/products/${editingProduct}` : "/api/v1/products";
    void writeInventory(path, editingProduct ? "PUT" : "POST", payload, editingProduct ? "Product updated." : "Product created.").then((saved) => {
      if (saved) {
        setEditingProduct(null);
        setProductForm(emptyProductForm);
      }
    });
  }

  function editProduct(product: InventoryProduct) {
    setEditingProduct(product.id);
    setProductForm({
      name: product.name,
      sku: product.sku ?? "",
      unit: product.unit,
      selling_price: product.selling_price,
      minimum_stock: product.minimum_stock,
      aliases: product.aliases.join(", "),
      active: product.active,
    });
  }

  async function saveStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const shared = { product_id: stockForm.product_id, quantity: stockForm.quantity, unit: stockForm.unit, note: stockForm.note || null };
    let saved: boolean;
    if (stockMode === "receipt") {
      saved = await writeInventory("/api/v1/inventory/receipts", "POST", { ...shared, location_id: stockForm.location_id }, "Stock received and saved.");
    } else if (stockMode === "adjustment") {
      saved = await writeInventory("/api/v1/inventory/adjustments", "POST", {
        product_id: stockForm.product_id,
        location_id: stockForm.location_id,
        quantity_change: stockForm.quantity,
        unit: stockForm.unit,
        note: stockForm.note || null,
      }, "Stock adjustment saved.");
    } else {
      saved = await writeInventory("/api/v1/inventory/transfers", "POST", {
        ...shared,
        source_location_id: stockForm.source_location_id,
        destination_location_id: stockForm.destination_location_id,
      }, "Stock transfer saved.");
    }
    if (saved) {
      setStockForm((current) => ({ ...current, quantity: "", note: "" }));
    }
  }

  function saveLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void writeInventory("/api/v1/locations", "POST", {
      name: locationForm.name,
      parent_location_id: locationForm.parent_location_id || null,
    }, "Location created.").then((saved) => {
      if (saved) setLocationForm({ name: "", parent_location_id: "" });
    });
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCustomerError("");
    setCustomerNotice("");
    const path = customerEditingId ? `/api/v1/customers/${customerEditingId}` : "/api/v1/customers";
    try {
      const response = await fetch(path, {
        method: customerEditingId ? "PUT" : "POST",
        headers,
        body: JSON.stringify({
          name: customerForm.name,
          phone: customerForm.phone || null,
          address: customerForm.address || null,
          notes: customerForm.notes || null,
        }),
      });
      if (!response.ok) throw new Error(await apiError(response, "Could not save customer."));
      const saved = (await response.json()) as Customer;
      setCustomerNotice(customerEditingId ? "Customer details saved." : "Customer account created.");
      setCustomerEditingId("");
      setCustomerForm({ name: "", phone: "", address: "", notes: "" });
      setSelectedCustomerId(saved.id);
      await Promise.all([loadCustomers(), loadCustomerLedger(saved.id)]);
    } catch (caught) {
      setCustomerError(caught instanceof Error ? caught.message : "Could not save customer.");
    }
  }

  async function recordCustomerPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCustomerId) return;
    setCustomerError("");
    setCustomerNotice("");
    customerPaymentKeyRef.current ??= window.crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/customers/${selectedCustomerId}/payments`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": customerPaymentKeyRef.current },
        body: JSON.stringify({ amount: customerPayment }),
      });
      if (!response.ok) throw new Error(await apiError(response, "Could not record payment."));
      const result = (await response.json()) as { outstanding_balance: string };
      customerPaymentKeyRef.current = null;
      setCustomerPayment("");
      setCustomerNotice(`Payment recorded. Outstanding balance: ₹${result.outstanding_balance}.`);
      await Promise.all([
        loadCustomers(),
        loadCustomerLedger(selectedCustomerId),
      ]);
    } catch (caught) {
      setCustomerError(caught instanceof Error ? caught.message : "Could not record payment.");
    }
  }

  async function recordCustomerSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCustomerId) return;
    setCustomerError("");
    setCustomerNotice("");
    customerSaleKeyRef.current ??= window.crypto.randomUUID();
    const product = products.find((item) => item.id === customerSale.product_id) ?? products.find((item) => item.active);
    const locationId = customerSale.location_id || locations[0]?.id;
    if (!product || !locationId) {
      setCustomerError("Add an active product and location before recording a sale.");
      return;
    }
    try {
      const response = await fetch("/api/v1/sales", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": customerSaleKeyRef.current },
        body: JSON.stringify({
          product_id: product.id,
          location_id: locationId,
          quantity: customerSale.quantity,
          customer_id: selectedCustomerId,
          paid_amount: customerSale.paid_amount,
          unit: product.unit,
        }),
      });
      if (!response.ok) throw new Error(await apiError(response, "Could not record sale."));
      const result = (await response.json()) as { message: string; outstanding_balance: string };
      customerSaleKeyRef.current = null;
      setCustomerSale((current) => ({ ...current, quantity: "", paid_amount: "0" }));
      setCustomerNotice(`${result.message} Outstanding balance: ₹${result.outstanding_balance}.`);
      await Promise.all([
        loadDashboard(),
        loadInventory(),
        loadStockMovements(),
        loadCustomers(),
        loadSalesHistory(),
        loadCustomerLedger(selectedCustomerId),
      ]);
    } catch (caught) {
      setCustomerError(caught instanceof Error ? caught.message : "Could not record sale.");
    }
  }

  function selectStockProduct(productId: string) {
    const product = products.find((item) => item.id === productId);
    setStockForm((current) => ({ ...current, product_id: productId, unit: product?.unit ?? "" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAnswer(null);
    setLoading(true);
    try {
      if (commandRequestKeyRef.current?.query !== query) {
        commandRequestKeyRef.current = { query, key: window.crypto.randomUUID() };
      }
      const response = await fetch("/api/v1/ask", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": commandRequestKeyRef.current.key },
        body: JSON.stringify({ query, mode: assistantMode }),
      });
      if (!response.ok) {
        throw new Error(await apiError(response, "Could not reach Vittavani. Check that the API is running."));
      }
      const result = (await response.json()) as Answer;
      setAnswer(result);
      commandRequestKeyRef.current = null;
      if (result.action_result) {
        const actionCustomerId = result.action_result.customer_id;
        if (typeof actionCustomerId === "string") setSelectedCustomerId(actionCustomerId);
        await Promise.all([
          loadDashboard(),
          loadInventory(),
          loadStockMovements(),
          loadCustomers(),
          loadSalesHistory(),
          loadCustomerLedger(typeof actionCustomerId === "string" ? actionCustomerId : undefined),
        ]);
      }
      if (speakAnswers && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(result.message);
        utterance.lang = speechLanguage;
        utterance.onstart = () => setSpeaking(true);
        utterance.onend = () => setSpeaking(false);
        utterance.onerror = () => setSpeaking(false);
        window.speechSynthesis.speak(utterance);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function startListening() {
    setVoiceError("");
    const browserWindow = window as SpeechWindow;
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceError("Voice input is not supported in this browser. You can still type your question.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    window.speechSynthesis?.cancel();
    setSpeaking(false);
    const recognition = new Recognition();
    let receivedTranscript = false;
    let recognitionFailed = false;
    recognition.lang = speechLanguage;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, index) =>
        event.results[index][0].transcript,
      ).join(" ").trim();
      if (transcript) {
        receivedTranscript = true;
        setQuery(transcript);
      }
    };
    recognition.onerror = (event) => {
      recognitionFailed = true;
      const messages: Record<string, string> = {
        "not-allowed": "Microphone permission was denied. Allow microphone access or type your question.",
        "service-not-allowed": "Microphone access is blocked by your browser or device. You can type instead.",
        "audio-capture": "No microphone was found. Connect a microphone or type your question.",
        "no-speech": "We didn’t hear anything. Try again or type your question.",
        network: "Voice recognition needs an internet connection. You can type your question.",
      };
      setVoiceError(messages[event.error] ?? "Voice input stopped unexpectedly. Please try again or type your question.");
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (!receivedTranscript && !recognitionFailed) {
        setVoiceError("No words were recognized. Try again or type your question.");
      }
      window.setTimeout(() => askInputRef.current?.focus(), 0);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setVoiceError("Could not start the microphone. Please try again or type your question.");
    }
  }

  function changeSpeakAnswers(enabled: boolean) {
    setSpeakAnswers(enabled);
    window.localStorage.setItem("vittavani-speak-answers", String(enabled));
    if (!enabled) {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
    }
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }

  const locationNames = useMemo(
    () => new Map(locations.map((location) => [location.id, location.full_name])),
    [locations],
  );
  const visibleProducts = useMemo(() => products
    .filter((product) => {
      const search = productSearch.trim().toLocaleLowerCase();
      const matchesSearch = !search || [
        product.name,
        product.sku ?? "",
        ...product.aliases,
      ].some((value) => value.toLocaleLowerCase().includes(search));
      const matchesStatus = productStatusFilter === "all"
        || product.stock_status === productStatusFilter.replaceAll("-", "_");
      return matchesSearch && matchesStatus;
    })
    .sort((left, right) => productSort === "quantity"
      ? compareDecimalStrings(right.quantity, left.quantity) || left.name.localeCompare(right.name)
      : left.name.localeCompare(right.name)),
  [products, productSearch, productStatusFilter, productSort]);
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const visibleCustomers = customers.filter((customer) => {
    const term = customerSearch.trim().toLocaleLowerCase();
    return !term || customer.name.toLocaleLowerCase().includes(term) || (customer.phone ?? "").includes(term);
  });
  const aiStatusMessage = useMemo(() => aiStatusError
    ? aiStatusError
    : aiConfigured
      ? `AI query interpretation is available via ${aiProvider} · ${aiModel}. Verified sales and stock facts come from your saved business records.`
      : "AI Assistant is not configured. Set AI_PROVIDER, AI_MODEL, and GROQ_API_KEY in the backend environment, or switch to Normal Search.",
  [aiStatusError, aiConfigured, aiProvider, aiModel]);
  const activeProductCount = useMemo(() => products.filter((product) => product.active).length, [products]);
  const salesOverview = dashboard?.sales_overview;
  const maxDailySales = Math.max(
    0,
    ...(salesOverview?.trend ?? []).map((day) => Number(day.total_amount)),
  );
  const recentSalesExist = Boolean(salesOverview?.trend.some((day) => day.sale_count > 0));
  const profileName = getDisplayName(profileUser);
  const profileEmail = profileUser?.email?.trim() ?? "";
  const profileImageUrl = getProfileImageUrl(profileUser);
  const greeting = getTimeGreeting(clockNow, businessProfile?.timezone ?? "Asia/Kolkata");
  const salesComparison = salesOverview
    && salesOverview.current_period.sale_count > 0
    && salesOverview.previous_period.sale_count > 0
    ? {
        direction: Number(salesOverview.current_period.total_amount) - Number(salesOverview.previous_period.total_amount),
        current: salesOverview.current_period.total_amount,
        previous: salesOverview.previous_period.total_amount,
      }
    : null;
  const profileEnabled = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const stockAlertRows = useMemo(() => products
    .filter((product): product is InventoryProduct & { stock_status: "low_stock" | "out_of_stock" } =>
      product.stock_status === "low_stock" || product.stock_status === "out_of_stock")
    .map((product) => ({
      id: product.id,
      name: product.name,
      available: product.display_quantity,
      minimum: product.display_minimum_stock,
      location: product.stock_status === "out_of_stock"
        ? "No available stock"
        : product.balances
          .filter((balance) => compareDecimalStrings(balance.quantity, "0") > 0)
          .map((balance) => `${locationNames.get(balance.location_id) ?? balance.location_name}: ${balance.display_quantity}`)
          .join(" · ") || "Location not recorded",
      status: product.stock_status,
    })),
  [products, locationNames]);

  return (
    <main className="page">
      <header className="topbar">
        <a className="brand" href="#dashboard" aria-label="Vittavani dashboard">
          <span className="brand-mark" aria-hidden="true"><span>வி</span></span>
          <span>Vittavani</span>
        </a>
        <button
          className="mobile-menu-button"
          type="button"
          aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-controls="workspace-sidebar"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">{mobileMenuOpen ? "×" : "☰"}</span>
        </button>
        <label className="global-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                window.location.hash = "inventory";
              }
            }}
            placeholder="Search products, aliases, SKU"
            aria-label="Search inventory products"
          />
        </label>
        <div className="topbar-actions">
          <label className="top-language" htmlFor="top-language">
            <span className="language-globe" aria-hidden="true">◎</span>
            <select id="top-language" value={speechLanguage} onChange={(event) => setSpeechLanguage(event.target.value)} aria-label="Voice language">
              <option value="hi-IN">हिंदी</option>
              <option value="en-IN">English</option>
            </select>
          </label>
          <a className="notification-button" href="#stock-alerts" aria-label={`Stock alerts: ${stockAlertRows.length}`}>
            <span aria-hidden="true">♧</span>
            {stockAlertRows.length > 0 && <span className="notification-count">{stockAlertRows.length}</span>}
          </a>
          <div className="business-context"><span className="business-avatar">{getProfileInitials(businessProfile?.name ?? "")}</span><span><strong>{businessProfile?.name ?? "Business workspace"}</strong><small>A product of Vinayaka Services</small></span></div>
          {profileEnabled && (
            <>
              <div className="profile-control" ref={profileMenuRef}>
                <button
                  className="profile-trigger"
                  type="button"
                  aria-label={`${profileMenuOpen ? "Close" : "Open"} profile menu for ${profileName || "account"}`}
                  aria-haspopup="dialog"
                  aria-expanded={profileMenuOpen}
                  aria-controls="profile-menu"
                  ref={profileTriggerRef}
                  onClick={() => setProfileMenuOpen((open) => !open)}
                >
                  {profileImageUrl
                    ? <img src={profileImageUrl} alt="" referrerPolicy="no-referrer" />
                    : <span>{getProfileInitials(profileName, profileEmail)}</span>}
                </button>
                {profileMenuOpen && (
                  <section className="profile-menu" id="profile-menu" role="dialog" aria-label="Account profile">
                    <strong className="profile-menu-name">{profileName || "Account"}</strong>
                    <span className="profile-menu-email">{profileEmail || "Email not available"}</span>
                    <span className="profile-menu-business">{businessProfile?.name ?? "Business workspace"}</span>
                    <button className="logout-button profile-menu-logout" type="button" onClick={signOut}>Log Out</button>
                  </section>
                )}
              </div>
              <button className="logout-button" type="button" onClick={signOut}>Log Out</button>
            </>
          )}
        </div>
      </header>

      <div className="app-layout">
        {mobileMenuOpen && (
          <button
            className="mobile-sidebar-backdrop"
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
        <aside
          className={`sidebar${sidebarCollapsed ? " sidebar-collapsed" : ""}${mobileMenuOpen ? " sidebar-mobile-open" : ""}`}
          id="workspace-sidebar"
          aria-label="Workspace navigation"
        >
          <div className="sidebar-control-row">
            <p className="sidebar-caption">WORKSPACE</p>
            <button
              className="sidebar-toggle"
              type="button"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-controls="workspace-sidebar"
              aria-expanded={!sidebarCollapsed}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={toggleSidebar}
            >
              <span aria-hidden="true">{sidebarCollapsed ? "◨" : "◧"}</span>
            </button>
          </div>
          <nav className="sidebar-nav">
            {navigationItems.map((item) => "reason" in item ? (
              <span
                className="nav-unavailable"
                role="link"
                aria-disabled="true"
                aria-label={`${item.label}, not available yet`}
                title={`${item.label}: ${item.reason}`}
                key={item.label}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
                <span className="sr-only">, not available yet</span>
                <small>Later</small>
              </span>
            ) : (
              <a
                className={activeSection === item.section ? "nav-active" : ""}
                aria-current={activeSection === item.section ? "page" : undefined}
                aria-label={item.label}
                href={`#${item.section}`}
                key={item.section}
                title={item.label}
                onClick={() => {
                  setActiveSection(item.section);
                  setMobileMenuOpen(false);
                }}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </a>
            ))}
          </nav>
          <div className="sidebar-assistant">
            <div className="sidebar-assistant-icon">✦</div>
            <strong>Business, by voice</strong>
            <p>Ask about real stock in English, Hindi, or Hinglish.</p>
            <a href="#ask" onClick={() => { setActiveSection("ask"); setMobileMenuOpen(false); }}>Ask Vittavani <span aria-hidden="true">→</span></a>
          </div>
          <div className="sidebar-footer"><span className="sidebar-footer-mark">வி</span><span><strong>Vittavani</strong><small>by Vinayaka Services</small></span></div>
        </aside>
        <div className={`workspace workspace-${activeSection}`}>
      <section className="dashboard-section" id="dashboard" data-page-section="dashboard" hidden={activeSection !== "dashboard"} aria-labelledby="dashboard-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR BUSINESS AT A GLANCE</p>
            <h1 id="dashboard-title">{greeting}, {profileName || "there"}<span className="heading-dot">!</span></h1>
            <p className="intro dashboard-supporting-line">Here’s what’s happening{businessProfile?.name ? ` at ${businessProfile.name}` : " in your business"} today.</p>
          </div>
          <button className="refresh-button" type="button" onClick={() => void loadDashboard()} disabled={dashboardLoading}>
            {dashboardLoading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
        <span className="stock-alert-anchor" id="stock-alerts" aria-hidden="true" />

        {dashboardLoading && (
          <div className="loading-grid" role="status" aria-label="Loading inventory dashboard">
            {Array.from({ length: 4 }, (_, index) => <span className="skeleton" key={index} />)}
          </div>
        )}
        {dashboardError && (
          <div className="dashboard-state state-error" role="alert">
            <span>{dashboardError}</span>
            <button className="text-button" type="button" onClick={() => void loadDashboard()}>Try again</button>
          </div>
        )}
        {!dashboardLoading && !dashboardError && !inventoryLoading && !inventoryError && dashboard && dashboard.product_count === 0 && products.length === 0 && (
          <div className="dashboard-state empty-state">
            <strong>Your inventory is ready when you are.</strong>
            <span>No products have been added yet, so there are no stock totals or alerts to show.</span>
          </div>
        )}
        {!dashboardLoading && !dashboardError && !inventoryLoading && !inventoryError && dashboard && dashboard.product_count === 0 && products.length > 0 && (
          <div className="dashboard-state empty-state">
            <strong>No active products.</strong>
            <span>Your catalogue has products, but none are active for dashboard stock totals. Edit a product below to activate it.</span>
          </div>
        )}
        {!dashboardLoading && !dashboardError && dashboard && (
          <>
            <div className="inventory-glance-heading">
              <h2>Inventory at a glance</h2>
              <p>Key inventory metrics across your business.</p>
            </div>
            <div className="metrics-grid" aria-label="Inventory summary">
              <Metric label="Active products" value={String(activeProductCount)} detail="Products in your catalogue" icon="▤" tone="cyan" />
              <Metric
                label="Stock on hand"
                value={
                  dashboard.stock_by_unit.length === 1
                    ? dashboard.stock_by_unit[0].display_quantity
                    : dashboard.stock_by_unit.length > 1
                      ? "Mixed units"
                      : "0"
                }
                detail={
                  dashboard.stock_by_unit.length > 1
                    ? `${dashboard.stock_by_unit.map((stock) => stock.display_quantity).join(" · ")} — units kept separate`
                    : dashboard.stock_by_unit.length === 1
                      ? "On hand across recorded locations"
                      : "No stock currently recorded"
                }
                icon="◫"
                tone="blue"
              />
              <Metric
                label="Low stock"
                value={String(dashboard.low_stock_count)}
                detail="In-stock products at/below configured minimum"
                icon="⌁"
                tone="purple"
              />
              <Metric
                label="Out of stock"
                value={String(dashboard.out_of_stock_count)}
                detail="Active products with no stock"
                icon="!"
                tone="orange"
              />
            </div>
            <section className="quick-actions-panel" aria-labelledby="quick-actions-title">
              <div className="panel-title-row">
                <div><p className="eyebrow">TAKE ACTION</p><h2 id="quick-actions-title">Quick actions</h2></div>
                <span className="panel-sparkle" aria-hidden="true">✦</span>
              </div>
              <div className="quick-actions">
                <a className="quick-action action-cyan" href="#stock-entry" onClick={() => { setStockMode("receipt"); setActiveSection("inventory"); }}><span>＋</span><strong>Receive stock</strong><small>Record incoming items</small></a>
                <a className="quick-action action-blue" href="#stock-entry" onClick={() => { setStockMode("transfer"); setActiveSection("inventory"); }}><span>⇄</span><strong>Transfer stock</strong><small>Move between locations</small></a>
                <a className="quick-action action-purple" href="#product-form-title" onClick={() => setActiveSection("inventory")}><span>▤</span><strong>Add product</strong><small>Grow your catalogue</small></a>
                <a className="quick-action action-orange" href="#customers" onClick={() => setActiveSection("customers")}><span>₹</span><strong>Create sale</strong><small>Record a customer sale</small></a>
                <a className="quick-action action-cyan" href="#customers" onClick={() => setActiveSection("customers")}><span>♙</span><strong>Customer accounts</strong><small>View balances and ledger</small></a>
              </div>
            </section>
            <div className="dashboard-operations">
            <div className="dashboard-columns">
              <section className="data-card" aria-labelledby="low-stock-title">
                <div className="card-heading">
                  <div>
                    <h2 id="low-stock-title">Stock alerts</h2>
                    <p>Low and out-of-stock products to review</p>
                  </div>
                  <span className="count-pill">{stockAlertRows.length}</span>
                </div>
                {stockAlertRows.length === 0 ? (
                  <p className="card-empty">No low- or out-of-stock products to review.</p>
                ) : (
                  <ul className="data-list">
                    {stockAlertRows.map((product) => (
                      <li key={product.id}>
                        <span><strong>{product.name}</strong><small>Available {product.available} · minimum {product.minimum} · {product.location}</small></span>
                        <span className={`stock-status stock-status-${product.status}`}>{stockStatusLabels[product.status]}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="data-card" aria-labelledby="location-stock-title">
                <div className="card-heading">
                  <div>
                    <h2 id="location-stock-title">Stock by location</h2>
                    <p>Recorded units and products at each location</p>
                  </div>
                </div>
                {dashboard.stock_by_location.length === 0 ? (
                  <p className="card-empty">No stock has been assigned to a storage location yet.</p>
                ) : (
                  <ul className="data-list">
                    {dashboard.stock_by_location.map((location) => (
                      <li key={location.id}>
                        <span><strong>{location.name}</strong><small>{location.product_count} {location.product_count === 1 ? "product" : "products"}</small></span>
                        <span className="stock-quantity">{location.stock_by_unit.map((stock) => stock.display_quantity).join(" · ") || "0 units"}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <section className="data-card activity-card" aria-labelledby="activity-title">
              <div className="card-heading">
                <div>
                  <h2 id="activity-title">Recent stock movements</h2>
                  <p>Latest committed inventory changes</p>
                </div>
                <a className="view-all-link" href="#stock-movements" onClick={() => setActiveSection("stock-movements")}>View all <span aria-hidden="true">→</span></a>
              </div>
              {dashboard.recent_stock_activity.length === 0 ? (
                <p className="card-empty">Stock activity will appear here when receipts or transfers are recorded.</p>
              ) : (
                <ul className="data-list activity-list">
                  {dashboard.recent_stock_activity.map((movement) => {
                    const presentation = movementPresentation(movement.movement_type);
                    return <li key={movement.id}>
                      <span>
                        <strong>{movement.product_name} <span className="movement-type">{movementLabel(movement.movement_type)}</span></strong>
                        <small>
                          {movement.source_location ? `${movement.source_location} → ` : ""}
                          {movement.destination_location ?? movement.source_location ?? "Location not recorded"}
                        </small>
                        <small>{new Date(movement.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small>
                      </span>
                      <span className={`movement-quantity movement-${presentation.kind}`}>{presentation.icon} {movement.display_quantity}</span>
                    </li>;
                  })}
                </ul>
              )}
            </section>
            </div>
          </>
        )}
        {!dashboardLoading && !dashboardError && salesOverview && (
          <section className="data-card sales-overview" aria-labelledby="sales-overview-title">
            <div className="card-heading">
              <div>
                <h2 id="sales-overview-title">Sales overview</h2>
                <p>Recorded sales in {salesOverview.timezone} · today and the last 7 days</p>
              </div>
              <a className="view-all-link" href="#sales" onClick={() => setActiveSection("sales")}>Sales history <span aria-hidden="true">→</span></a>
            </div>
            <div className="sales-summary-grid">
              <article className="sales-kpi-blue"><span>Sales today</span><strong>{formatCurrency(salesOverview.today.total_amount, salesOverview.currency)}</strong></article>
              <article className="sales-kpi-cyan">
                <span>Items sold today</span>
                <strong>
                  {salesOverview.today.quantity_by_unit.length
                    ? salesOverview.today.quantity_by_unit.map((item) => `${item.quantity} ${item.unit}`).join(" · ")
                    : "0"}
                </strong>
              </article>
              <article className="sales-kpi-purple"><span>Sales transactions</span><strong>{salesOverview.today.sale_count}</strong><small>Completed sales recorded today</small></article>
              <article className="sales-kpi-amber"><span>Pending customer dues</span><strong>{formatCurrency(salesOverview.pending_customer_balances, salesOverview.currency)}</strong></article>
            </div>
            {!recentSalesExist && (
              <p className="sales-empty-state">No sales were recorded in the last 7 days. Record sales to see trends and top-selling products here.</p>
            )}
            <div className="sales-detail-grid">
              <div>
                <h3>Sales trend</h3>
                {salesComparison && <p className="sales-period-comparison">
                  Last 7 days: {formatCurrency(salesComparison.current, salesOverview.currency)}
                  {" · "}previous 7 days: {formatCurrency(salesComparison.previous, salesOverview.currency)}
                </p>}
                <ol className="sales-trend" aria-label="Daily sales for the last 7 days">
                  {salesOverview.trend.map((day) => {
                    const amount = Number(day.total_amount);
                    const height = maxDailySales > 0 ? Math.max(4, amount / maxDailySales * 100) : 0;
                    return (
                      <li key={day.date} aria-label={`${day.date}: ${formatCurrency(day.total_amount, salesOverview.currency)}; ${day.sale_count} sales`}>
                        <span className="sales-trend-amount">{formatCurrency(day.total_amount, salesOverview.currency)}</span>
                        <span className="sales-trend-track"><span style={{ height: `${height}%` }} /></span>
                        <time dateTime={day.date}>{day.date.slice(5)}</time>
                      </li>
                    );
                  })}
                </ol>
              </div>
              <div>
                <h3>Top-selling products · 7 days</h3>
                {salesOverview.top_products.length === 0 ? (
                  <p className="card-empty">No product sales to rank yet.</p>
                ) : (
                  <ol className="data-list sales-top-products">
                    {salesOverview.top_products.map((product) => (
                      <li key={product.product_id}>
                        <strong>{product.name}</strong>
                        <span className="stock-quantity">{product.quantity} {product.unit}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
            <p className="sales-data-note">{salesOverview.sales_status_note}</p>
          </section>
        )}
        {!dashboardLoading && !dashboardError && (
          <section className="business-insights" aria-labelledby="business-insights-title">
            <div className="insights-heading">
              <div><p className="eyebrow">RECORD-BASED GUIDANCE</p><h2 id="business-insights-title">Vittavani’s business insights</h2></div>
              <span>Based on saved sales and stock data</span>
            </div>
            <div className="insight-list">
              {salesComparison && salesOverview && (
                <article className="insight-card insight-sales">
                  <span className="insight-icon" aria-hidden="true">↗</span>
                  <div>
                    <h3>{salesComparison.direction > 0 ? "Recorded sales increased" : salesComparison.direction < 0 ? "Recorded sales decreased" : "Recorded sales were unchanged"}</h3>
                    <p>The last seven days totalled {formatCurrency(salesComparison.current, salesOverview.currency)}, compared with {formatCurrency(salesComparison.previous, salesOverview.currency)} in the previous seven days.</p>
                    <a href="#sales" onClick={() => setActiveSection("sales")}>View sales history <span aria-hidden="true">→</span></a>
                  </div>
                </article>
              )}
              {stockAlertRows.length > 0 && (
                <article className="insight-card insight-stock">
                  <span className="insight-icon" aria-hidden="true">!</span>
                  <div>
                    <h3>Review stock levels</h3>
                    <p>{stockAlertRows[0].name} has {stockAlertRows[0].available} available against a minimum of {stockAlertRows[0].minimum}.</p>
                    <a href="#inventory" onClick={() => setActiveSection("inventory")}>Review inventory <span aria-hidden="true">→</span></a>
                  </div>
                </article>
              )}
              {!salesComparison && stockAlertRows.length === 0 && (
                <p className="insights-empty">More recorded sales or stock activity is needed to provide business-specific insights.</p>
              )}
            </div>
          </section>
        )}
      </section>

      <section className="inventory-section" id="inventory" data-page-section="inventory" hidden={activeSection !== "inventory"} aria-labelledby="inventory-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">PRODUCTS AND STOCK CONTROL</p>
            <h2 id="inventory-title">Inventory</h2>
            <p className="intro">Manage catalogue details and record stock changes against saved locations.</p>
          </div>
          <button className="refresh-button" type="button" onClick={() => void loadInventory()} disabled={inventoryLoading}>
            {inventoryLoading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
        {inventoryLoading && (
          <div className="inventory-loading" role="status" aria-label="Loading products and locations">
            <span className="skeleton" /><span className="skeleton" />
          </div>
        )}
        {inventoryError && (
          <div className="dashboard-state state-error" role="alert">
            <span>{inventoryError}</span>
            <button className="text-button" type="button" onClick={() => void loadInventory()}>Try again</button>
          </div>
        )}
        {inventoryNotice && <p className="inventory-notice" role="status">{inventoryNotice}</p>}
        {inventoryWriteError && <p className="notice error" role="alert">{inventoryWriteError}</p>}
        {!inventoryLoading && !inventoryError && (
          <>
            <div className="inventory-grid">
              <section className="data-card" aria-labelledby="product-form-title">
                <div className="card-heading">
                  <div>
                    <h3 id="product-form-title">{editingProduct ? "Edit product" : "Add a product"}</h3>
                    <p>Product details and low-stock threshold</p>
                  </div>
                </div>
                <form className="inventory-form" onSubmit={saveProduct}>
                  <label>Product name<input required maxLength={180} value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} /></label>
                  <div className="form-row">
                    <label>SKU (optional)<input maxLength={80} value={productForm.sku} onChange={(event) => setProductForm({ ...productForm, sku: event.target.value })} />
                      {editingProduct && <small className="form-help">Clear the field to remove the current SKU.</small>}
                    </label>
                    <label>Unit<input required maxLength={32} value={productForm.unit} onChange={(event) => setProductForm({ ...productForm, unit: event.target.value })} /></label>
                  </div>
                  <div className="form-row">
                    <label>Selling price (₹)<input type="number" min="0" step="0.01" required value={productForm.selling_price} onChange={(event) => setProductForm({ ...productForm, selling_price: event.target.value })} /></label>
                    <label>Minimum stock<input type="number" min="0" step="0.001" required value={productForm.minimum_stock} onChange={(event) => setProductForm({ ...productForm, minimum_stock: event.target.value })} /></label>
                  </div>
                  <label>Search aliases (comma-separated)<input value={productForm.aliases} onChange={(event) => setProductForm({ ...productForm, aliases: event.target.value })} placeholder="Hindi, Hinglish, or alternate names" /></label>
                  {editingProduct && <label>Status<select value={productForm.active ? "active" : "inactive"} onChange={(event) => setProductForm({ ...productForm, active: event.target.value === "active" })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>}
                  <div className="form-actions">
                    <button className="submit" type="submit" disabled={writing}>{writing ? "Saving…" : editingProduct ? "Save product" : "Add product"}</button>
                    {editingProduct && <button className="refresh-button" type="button" onClick={() => { setEditingProduct(null); setProductForm(emptyProductForm); }}>Cancel</button>}
                  </div>
                </form>
              </section>

              <section className="data-card" aria-labelledby="stock-form-title">
                <div className="card-heading">
                  <div>
                    <h3 id="stock-form-title">Record stock</h3>
                    <p>Changes are saved with a stock movement record.</p>
                  </div>
                </div>
                {products.filter((product) => product.active).length === 0 || locations.length === 0 ? (
                  <p className="card-empty">Add an active product and a storage location before recording stock changes.</p>
                ) : (
                  <form className="inventory-form" id="stock-entry" onSubmit={saveStock}>
                    <label>Action<select value={stockMode} onChange={(event) => setStockMode(event.target.value)}>
                      <option value="receipt">Receive stock</option>
                      <option value="adjustment">Adjust stock</option>
                      <option value="transfer">Transfer between locations</option>
                    </select></label>
                    <label>Product<select required value={stockForm.product_id} onChange={(event) => selectStockProduct(event.target.value)}>
                      {products.filter((product) => product.active).map((product) => <option key={product.id} value={product.id}>{product.name} ({product.unit})</option>)}
                    </select></label>
                    {stockMode === "transfer" ? (
                      <div className="form-row">
                        <label>From<select required value={stockForm.source_location_id} onChange={(event) => setStockForm({ ...stockForm, source_location_id: event.target.value })}>
                          {locations.map((location) => <option key={location.id} value={location.id}>{location.full_name}</option>)}
                        </select></label>
                        <label>To<select required value={stockForm.destination_location_id} onChange={(event) => setStockForm({ ...stockForm, destination_location_id: event.target.value })}>
                          {locations.map((location) => <option key={location.id} value={location.id}>{location.full_name}</option>)}
                        </select></label>
                      </div>
                    ) : (
                      <label>Location<select required value={stockForm.location_id} onChange={(event) => setStockForm({ ...stockForm, location_id: event.target.value })}>
                        {locations.map((location) => <option key={location.id} value={location.id}>{location.full_name}</option>)}
                      </select></label>
                    )}
                    <label>{stockMode === "adjustment" ? "Quantity change (negative to reduce)" : `Quantity (${stockForm.unit || "unit"})`}
                      <input type="number" step="0.001" required value={stockForm.quantity} onChange={(event) => setStockForm({ ...stockForm, quantity: event.target.value })} placeholder={stockMode === "adjustment" ? "-2 or 2" : "0"} />
                    </label>
                    <label>Note (optional)<input maxLength={500} value={stockForm.note} onChange={(event) => setStockForm({ ...stockForm, note: event.target.value })} /></label>
                    <div className="form-actions"><button className="submit" type="submit" disabled={writing || !stockForm.product_id || (stockMode === "transfer" ? !stockForm.source_location_id || !stockForm.destination_location_id : !stockForm.location_id)}>{writing ? "Saving…" : "Save stock change"}</button></div>
                  </form>
                )}
              </section>

              <section className="data-card location-form-card" aria-labelledby="location-form-title">
                <div className="card-heading">
                  <div>
                    <h3 id="location-form-title">Add a storage location</h3>
                    <p>Build a location hierarchy, such as Storeroom → Rack → Shelf.</p>
                  </div>
                </div>
                <form className="inventory-form location-form" onSubmit={saveLocation}>
                  <label>Location name<input required maxLength={120} value={locationForm.name} onChange={(event) => setLocationForm({ ...locationForm, name: event.target.value })} /></label>
                  <label>Parent location (optional)<select value={locationForm.parent_location_id} onChange={(event) => setLocationForm({ ...locationForm, parent_location_id: event.target.value })}>
                    <option value="">Top-level location</option>
                    {locations.map((location) => <option key={location.id} value={location.id}>{location.full_name}</option>)}
                  </select></label>
                  <div className="form-actions"><button className="refresh-button" type="submit" disabled={writing}>{writing ? "Saving…" : "Add location"}</button></div>
                </form>
              </section>
            </div>

            <section className="data-card inventory-products" aria-labelledby="inventory-products-title">
              <div className="card-heading">
                <div><h3 id="inventory-products-title">Product balances</h3><p>Persisted balances grouped by product and location</p></div>
                <span className="count-pill">{products.length}</span>
              </div>
              <div className="inventory-toolbar">
                <label className="search-field">Search products<input type="search" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Name, SKU, or alias" /></label>
                <label>Stock status<select value={productStatusFilter} onChange={(event) => setProductStatusFilter(event.target.value)}>
                  <option value="all">All products</option><option value="in-stock">In stock</option>
                  <option value="low-stock">Low stock</option><option value="out-of-stock">Out of stock</option>
                  <option value="inactive">Inactive</option>
                </select></label>
                <label>Sort by<select value={productSort} onChange={(event) => setProductSort(event.target.value)}>
                  <option value="name">Name</option><option value="quantity">Stock quantity</option>
                </select></label>
              </div>
              {products.length === 0 ? <p className="card-empty">No products yet. Add a product above to begin building your catalogue.</p> : (
                <ul className="data-list product-list">
                  {visibleProducts.map((product) => (
                    <li key={product.id}>
                      <span>
                        <strong>{product.name}</strong>
                        <span className={`stock-status stock-status-${product.stock_status}`}>{stockStatusLabels[product.stock_status]}</span>
                        <small>{productDetails(product, locationNames)}</small>
                      </span>
                      <span className="product-total">{product.display_quantity}</span>
                      <button className="text-button" type="button" onClick={() => editProduct(product)}>Edit</button>
                    </li>
                  ))}
                </ul>
              )}
              {products.length > 0 && visibleProducts.length === 0 && <p className="card-empty">No products match those filters.</p>}
            </section>
          </>
        )}
      </section>

      <section className="inventory-section auxiliary-section customer-section" id="customers" data-page-section="customers" hidden={activeSection !== "customers"} aria-labelledby="customers-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">CUSTOMER ACCOUNTS</p>
            <h2 id="customers-title">Customers &amp; Accounts</h2>
            <p className="intro">Manage customer accounts, credit sales, payments received, and outstanding balances.</p>
          </div>
          <button className="refresh-button" type="button" onClick={() => void loadCustomers()} disabled={customerLoading}>
            {customerLoading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
        {customerNotice && <p className="inventory-notice" role="status">{customerNotice}</p>}
        {customerError && <p className="notice error" role="alert">{customerError}</p>}
        <div className="customer-layout">
          <section className="data-card customer-list-card" aria-label="Customer list">
            <div className="card-heading">
              <div><h3>Customers</h3><p>{customers.length} saved accounts</p></div>
              <span className="count-pill">{customers.length}</span>
            </div>
            <label className="customer-search">Search by name or phone
              <input type="search" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} />
            </label>
            <button
              className="text-button customer-new-button"
              type="button"
              onClick={() => {
                setCustomerEditingId("");
                setCustomerForm({ name: "", phone: "", address: "", notes: "" });
              }}
            >
              + Add customer
            </button>
            {customerLoading ? (
              <p className="card-empty" role="status">Loading customers…</p>
            ) : customers.length === 0 ? (
              <p className="card-empty">No customer accounts yet. Add a customer to begin recording account activity.</p>
            ) : visibleCustomers.length === 0 ? (
              <p className="card-empty">No customers match that search.</p>
            ) : (
              <ul className="data-list customer-list">
                {visibleCustomers.map((customer) => (
                  <li key={customer.id}>
                    <button
                      className={`customer-select${customer.id === selectedCustomerId ? " customer-selected" : ""}`}
                      type="button"
                      onClick={() => setSelectedCustomerId(customer.id)}
                    >
                      <span><strong>{customer.name}</strong><small>{customer.phone || "No phone number"}</small></span>
                      <span className="customer-balance">₹{customer.outstanding_balance}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="customer-detail-column">
            <section className="data-card" aria-labelledby="customer-form-title">
              <div className="card-heading">
                <div><h3 id="customer-form-title">{customerEditingId ? "Edit customer" : "Add customer"}</h3><p>Customer details are saved to this business account.</p></div>
              </div>
              <form className="inventory-form" onSubmit={saveCustomer}>
                <label>Name<input required maxLength={160} value={customerForm.name} onChange={(event) => setCustomerForm({ ...customerForm, name: event.target.value })} /></label>
                <label>Phone (optional)<input maxLength={32} value={customerForm.phone} onChange={(event) => setCustomerForm({ ...customerForm, phone: event.target.value })} /></label>
                <label>Address (optional)<input maxLength={300} value={customerForm.address} onChange={(event) => setCustomerForm({ ...customerForm, address: event.target.value })} /></label>
                <label>Notes (optional)<input maxLength={500} value={customerForm.notes} onChange={(event) => setCustomerForm({ ...customerForm, notes: event.target.value })} /></label>
                <div className="form-actions">
                  <button className="submit" type="submit">{customerEditingId ? "Save customer" : "Create customer"}</button>
                  {customerEditingId && <button className="refresh-button" type="button" onClick={() => { setCustomerEditingId(""); setCustomerForm({ name: "", phone: "", address: "", notes: "" }); }}>Cancel</button>}
                </div>
              </form>
            </section>

            {selectedCustomer ? (
              <>
                <section className="data-card customer-account-card" aria-labelledby="customer-account-title">
                  <div className="card-heading">
                    <div><h3 id="customer-account-title">{selectedCustomer.name}</h3><p>{selectedCustomer.phone || "Phone not recorded"}</p></div>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        setCustomerEditingId(selectedCustomer.id);
                        setCustomerForm({
                          name: selectedCustomer.name,
                          phone: selectedCustomer.phone ?? "",
                          address: selectedCustomer.address ?? "",
                          notes: selectedCustomer.notes ?? "",
                        });
                      }}
                    >
                      Edit
                    </button>
                  </div>
                  <p className="customer-outstanding">Outstanding <strong>₹{selectedCustomer.outstanding_balance}</strong></p>
                  <form className="customer-inline-form" onSubmit={recordCustomerSale}>
                    <strong>Record credit sale</strong>
                    <label>Product<select required value={customerSale.product_id || products.find((product) => product.active)?.id || ""} onChange={(event) => setCustomerSale({ ...customerSale, product_id: event.target.value })}>
                      {products.filter((product) => product.active).map((product) => <option key={product.id} value={product.id}>{product.name} · {product.unit}</option>)}
                    </select></label>
                    <div className="form-row">
                      <label>Location<select required value={customerSale.location_id || locations[0]?.id || ""} onChange={(event) => setCustomerSale({ ...customerSale, location_id: event.target.value })}>
                        {locations.map((location) => <option key={location.id} value={location.id}>{location.full_name}</option>)}
                      </select></label>
                      <label>Quantity<input type="number" min="0.001" step="0.001" required value={customerSale.quantity} onChange={(event) => setCustomerSale({ ...customerSale, quantity: event.target.value })} /></label>
                    </div>
                    <label>Amount paid now (₹)<input type="number" min="0" step="0.01" required value={customerSale.paid_amount} onChange={(event) => setCustomerSale({ ...customerSale, paid_amount: event.target.value })} /></label>
                    <button className="submit" type="submit">Save sale and update stock</button>
                  </form>
                  <form className="customer-inline-form" onSubmit={recordCustomerPayment}>
                    <strong>Record payment received</strong>
                    <label>Amount (₹)<input type="number" min="0.01" step="0.01" required value={customerPayment} onChange={(event) => setCustomerPayment(event.target.value)} /></label>
                    <button className="refresh-button" type="submit">Record payment</button>
                  </form>
                </section>
                <section className="data-card" aria-labelledby="customer-ledger-title">
                  <div className="card-heading"><div><h3 id="customer-ledger-title">Customer ledger</h3><p>Positive entries increase the outstanding balance; negative entries record payments.</p></div></div>
                  {customerLedger.length === 0 ? <p className="card-empty">No ledger entries recorded.</p> : (
                    <ul className="data-list customer-ledger">
                      {customerLedger.map((entry) => (
                        <li key={entry.id}>
                          <span><strong>{entry.transaction_type.replaceAll("_", " ")}</strong><small>{new Date(entry.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}{entry.note ? ` · ${entry.note}` : ""}</small></span>
                          <span className={entry.amount_delta.startsWith("-") ? "ledger-payment" : "ledger-debit"}>{entry.amount_delta.startsWith("-") ? "−" : "+"}₹{entry.amount_delta.replace("-", "")}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            ) : (
              <section className="data-card"><p className="card-empty">{customerLoading ? "Loading customer account…" : "Select or add a customer to view their ledger and record a payment or credit sale."}</p></section>
            )}
          </div>
        </div>
      </section>

      <section className="inventory-section auxiliary-section" id="sales" data-page-section="sales" hidden={activeSection !== "sales"} aria-labelledby="sales-history-title">
        <div className="section-heading"><div><p className="eyebrow">RECORDED BUSINESS ACTIVITY</p><h2 id="sales-history-title">Sales</h2><p className="intro">Sales recorded for this business.</p></div></div>
        <section className="data-card sales-history-card" aria-labelledby="sales-history-heading">
          <div className="card-heading"><div><h3 id="sales-history-heading">Sales history</h3><p>Saved sales and amounts from the API</p></div><span className="count-pill">{salesHistory.length}</span></div>
          {salesHistory.length === 0 ? <p className="card-empty">No sales have been recorded.</p> : (
            <ul className="data-list">
              {salesHistory.map((sale) => <li key={sale.id}>
                <span><strong>{sale.product_name} · {sale.quantity} {sale.unit}</strong><small>{sale.customer_name ?? "Cash sale"} · {new Date(sale.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></span>
                <span className="stock-quantity">₹{sale.total_amount}</span>
              </li>)}
            </ul>
          )}
        </section>
      </section>

      <section className="inventory-section auxiliary-section" id="locations" data-page-section="locations" hidden={activeSection !== "locations"} aria-labelledby="locations-title">
        <div className="section-heading">
          <div><p className="eyebrow">YOUR STORAGE MAP</p><h2 id="locations-title">Locations</h2><p className="intro">Browse your location hierarchy and recorded stock by unit.</p></div>
        </div>
        {locations.length === 0 ? <p className="dashboard-state empty-state">No locations have been created yet. Add one in Inventory to start organizing stock.</p> : (
          <div className="location-grid">
            {locations.map((location) => {
              const stock = dashboard?.stock_by_location.find((row) => row.id === location.id);
              return <article className="data-card location-card" key={location.id}>
                <span className="location-icon" aria-hidden="true">⌂</span>
                <h3>{location.name}</h3>
                <p>{location.full_name}</p>
                <small>{stock ? `${stock.product_count} ${stock.product_count === 1 ? "product" : "products"} · ${stock.stock_by_unit.map((item) => item.display_quantity).join(" · ")}` : "No stock recorded here"}</small>
              </article>;
            })}
          </div>
        )}
      </section>

      <section className="inventory-section auxiliary-section" id="stock-movements" data-page-section="stock-movements" hidden={activeSection !== "stock-movements"} aria-labelledby="stock-movements-title">
        <div className="section-heading">
          <div><p className="eyebrow">AUDIT TRAIL</p><h2 id="stock-movements-title">Stock movements</h2><p className="intro">Receipts, adjustments, and transfers recorded for your business.</p></div>
          <button className="refresh-button" type="button" onClick={() => void loadStockMovements()} disabled={movementLoading}>{movementLoading ? "Loading…" : "↻ Refresh"}</button>
        </div>
        {movementError ? (
          <div className="dashboard-state state-error" role="alert"><span>{movementError}</span><button className="text-button" type="button" onClick={() => void loadStockMovements()}>Try again</button></div>
        ) : movementLoading ? <p className="dashboard-state" role="status">Loading stock history…</p> : stockMovements.length === 0 ? (
          <p className="dashboard-state empty-state">Stock activity will appear after you record a receipt, adjustment, or transfer.</p>
        ) : (
          <div className="data-card movement-table-wrap">
            <table className="movement-table" aria-label="Stock movement history">
              <thead>
                <tr className="movement-row movement-header">
                  <th scope="col">Product / movement</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Route / note</th>
                  <th scope="col">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {stockMovements.map((movement) => <tr className="movement-row" key={movement.id}>
                  <td><strong>{movement.product_name}</strong><small>{movementLabel(movement.movement_type)}</small></td>
                  <td className="stock-quantity">{movement.display_quantity}</td>
                  <td><small>{movement.source_location ? `${movement.source_location} → ` : ""}{movement.destination_location ?? movement.source_location ?? "Location not recorded"}{movement.note ? ` · ${movement.note}` : ""}</small></td>
                  <td><time dateTime={movement.created_at}>{new Date(movement.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ask-section" id="ask" data-page-section="ask" hidden={activeSection !== "ask" && activeSection !== "dashboard"} aria-labelledby="welcome-title">
        <div className="assistant-heading">
          <span className="assistant-emblem" aria-hidden="true">✦</span>
          <p className="eyebrow">YOUR BUSINESS, IN YOUR WORDS</p>
          <h2 id="welcome-title">Ask Vittavani</h2>
          <p className="intro">Your business, in your words.</p>
        </div>
        <div className="assistant-modes" role="group" aria-label="Assistant mode">
          <button type="button" className={assistantMode === "normal" ? "mode-active" : ""} aria-pressed={assistantMode === "normal"} onClick={() => setAssistantMode("normal")}>Normal Search</button>
          <button type="button" className={assistantMode === "ai" ? "mode-active" : ""} aria-pressed={assistantMode === "ai"} onClick={() => setAssistantMode("ai")}>AI Assistant</button>
        </div>
        <p className={`ai-status${assistantMode === "ai" && !aiConfigured ? " ai-unavailable" : ""}`} role="status">
          {assistantMode === "normal"
              ? "Normal Search uses deterministic product, alias, and saved sales lookups; no AI service is required."
              : aiStatusMessage}
        </p>
        <form className="ask-card" onSubmit={submit}>
          <label htmlFor="business-query">What would you like to know?</label>
          <textarea
            id="business-query"
            ref={askInputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try “Amul butter kahan rakha hai?”"
            rows={3}
            maxLength={500}
            required
          />
          <div className="ask-options">
            <label className="language-label" htmlFor="speech-language">Voice language
              <select id="speech-language" value={speechLanguage} onChange={(event) => setSpeechLanguage(event.target.value)}>
                <option value="hi-IN">Hindi / Hinglish</option>
                <option value="en-IN">English (India)</option>
              </select>
            </label>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={speakAnswers}
                disabled={!speechOutputSupported}
                onChange={(event) => changeSpeakAnswers(event.target.checked)}
              />
              Speak answers
            </label>
          </div>
          {!speechOutputSupported && (
            <p className="voice-note">Spoken answers are not supported in this browser. Text answers will still work.</p>
          )}
          <div className="ask-footer">
            <button
              className={`mic-button${listening ? " mic-listening" : ""}`}
              type="button"
              onClick={startListening}
              aria-pressed={listening}
              aria-label={listening ? "Stop voice input" : "Start voice input"}
            >
              <span aria-hidden="true">{listening ? "■" : "🎙"}</span>
              {listening ? "Stop listening" : "Speak"}
            </button>
            <span className="text-hint">
              {listening ? "Listening… speak now. Your words will appear above." : "Type a question or use your microphone"}
            </span>
            <button className="submit" type="submit" disabled={loading || !query.trim()}>
              {loading ? "Checking…" : "Ask"}
              <span aria-hidden="true"> →</span>
            </button>
          </div>
        </form>
        <p className="voice-note">Voice input needs a supported browser and microphone permission. If it isn’t available, type your question. Choose Hindi / Hinglish for Hindi speech.</p>
        {voiceError && <p className="notice error" role="alert">{voiceError}</p>}
        <div className="examples" aria-label="Example questions">
          <span>Try asking</span>
          {examples.map((example) => (
            <button className="example" key={example} type="button" onClick={() => setQuery(example)}>
              {example}
            </button>
          ))}
        </div>
        {error && <p className="notice error" role="alert">{error}</p>}
        {answer && (
          <section className="notice result" aria-live="polite" aria-label="Answer">
            <p className="result-label">VITTAVANI · {answer.original_query}</p>
            <p className="result-message">{answer.message}</p>
            {answer.candidates.length > 0 && <p className="result-detail">Options: {answer.candidates.join(", ")}</p>}
            {speakAnswers && speaking && (
              <button className="text-button" type="button" onClick={stopSpeaking}>Stop spoken answer</button>
            )}
          </section>
        )}
      </section>
        </div>
      </div>
      <footer className="footer">A product of Vinayaka Services</footer>
    </main>
  );
}
