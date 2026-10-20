"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { compareDecimalStrings } from "../lib/quantity.mjs";
type Answer = {
  message: string;
  original_query: string;
  clarification_required: boolean;
  candidates: string[];
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
];
const stockStatusLabels = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
  inactive: "Inactive",
};
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
  tone: "green" | "blue" | "purple" | "orange";
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
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiStatusError, setAiStatusError] = useState("");
  const [aiProvider, setAiProvider] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("normal");
  const [activeSection, setActiveSection] = useState("dashboard");
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
    void loadDashboard();
    void loadInventory();
    void loadStockMovements();
    void loadAssistantStatus();
    setSpeakAnswers(window.localStorage.getItem("vittavani-speak-answers") === "true");
    setSpeechOutputSupported(
      "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined",
    );
    return () => {
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, [loadAssistantStatus, loadDashboard, loadInventory, loadStockMovements]);

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
      const response = await fetch("/api/v1/ask", {
        method: "POST",
        headers,
        body: JSON.stringify({ query, mode: assistantMode }),
      });
      if (!response.ok) {
        throw new Error(await apiError(response, "Could not reach Vittavani. Check that the API is running."));
      }
      const result = (await response.json()) as Answer;
      setAnswer(result);
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

  const locationNames = new Map(locations.map((location) => [location.id, location.full_name]));
  const visibleProducts = products
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
      : left.name.localeCompare(right.name));
  const aiStatusMessage = aiStatusError
    ? aiStatusError
    : aiConfigured
      ? `AI query interpretation is available via ${aiProvider} · ${aiModel}. Stock facts are still fetched from your inventory.`
      : "AI Assistant is not configured. Set AI_PROVIDER, AI_MODEL, and GROQ_API_KEY in the backend environment, or switch to Normal Search.";
  const activeProductCount = products.filter((product) => product.active).length;
  const stockAlertRows = [
    ...(dashboard?.low_stock_products.map((product) => {
      const inventoryProduct = products.find((item) => item.id === product.id);
      const locations = inventoryProduct?.balances
        .filter((balance) => compareDecimalStrings(balance.quantity, "0") > 0)
        .map((balance) => `${locationNames.get(balance.location_id) ?? balance.location_name}: ${balance.display_quantity}`)
        .join(" · ");
      return {
        id: product.id,
        name: product.name,
        available: product.display_quantity,
        minimum: product.display_minimum_stock,
        location: locations || "Location not recorded",
        status: "low_stock" as const,
      };
    }) ?? []),
    ...products
      .filter((product) => product.stock_status === "out_of_stock")
      .map((product) => ({
        id: product.id,
        name: product.name,
        available: product.display_quantity,
        minimum: product.display_minimum_stock,
        location: "No available stock",
        status: "out_of_stock" as const,
      })),
  ];

  return (
    <main className="page">
      <header className="topbar">
        <a className="brand" href="#dashboard" aria-label="Vittavani dashboard">
          <span className="brand-mark" aria-hidden="true"><span>வி</span></span>
          <span>Vittavani</span>
        </a>
        <label className="global-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                document.getElementById("inventory")?.scrollIntoView({ behavior: "smooth" });
              }
            }}
            placeholder="Search products, aliases, SKU"
            aria-label="Search inventory products"
          />
          <kbd>/</kbd>
        </label>
        <div className="topbar-actions">
          <label className="top-language" htmlFor="top-language">
            <span className="language-globe" aria-hidden="true">◎</span>
            <select id="top-language" value={speechLanguage} onChange={(event) => setSpeechLanguage(event.target.value)} aria-label="Voice language">
              <option value="hi-IN">हिंदी</option>
              <option value="en-IN">English</option>
            </select>
          </label>
          <a className="notification-button" href="#stock-alerts" aria-label={`Stock alerts: ${dashboard ? dashboard.low_stock_count + dashboard.out_of_stock_count : 0}`}>
            <span aria-hidden="true">♧</span>
            {dashboard && dashboard.low_stock_count + dashboard.out_of_stock_count > 0 && <span className="notification-count">{dashboard.low_stock_count + dashboard.out_of_stock_count}</span>}
          </a>
          <div className="business-context"><span className="business-avatar">V</span><span><strong>Business workspace</strong><small>A product of Vinayaka Services</small></span></div>
        </div>
      </header>

      <div className="app-layout">
        <aside className="sidebar" aria-label="Workspace navigation">
          <p className="sidebar-caption">WORKSPACE</p>
          <nav className="sidebar-nav">
            <a className={activeSection === "dashboard" ? "nav-active" : ""} href="#dashboard" onClick={() => setActiveSection("dashboard")}><span className="nav-icon">▦</span>Dashboard</a>
            <span className="nav-unavailable" title="Sales requires a backend module before it can be enabled"><span className="nav-icon">↗</span>Sales<small>Later</small></span>
            <a className={activeSection === "inventory" ? "nav-active" : ""} href="#inventory" onClick={() => setActiveSection("inventory")}><span className="nav-icon">▤</span>Inventory</a>
            <span className="nav-unavailable" title="Customer udhar requires a backend ledger before it can be enabled"><span className="nav-icon">♙</span>Customers &amp; Udhar<small>Later</small></span>
            <span className="nav-unavailable" title="Payment workflows are not implemented"><span className="nav-icon">↔</span>Payments &amp; Collections<small>Later</small></span>
            <span className="nav-unavailable" title="Purchasing workflows are not implemented"><span className="nav-icon">▣</span>Purchases<small>Later</small></span>
            <span className="nav-unavailable" title="Expense workflows are not implemented"><span className="nav-icon">◷</span>Expenses<small>Later</small></span>
            <a className={activeSection === "locations" ? "nav-active" : ""} href="#locations" onClick={() => setActiveSection("locations")}><span className="nav-icon">⌂</span>Locations</a>
            <span className="nav-unavailable" title="Financial reporting is not implemented"><span className="nav-icon">▥</span>Reports<small>Later</small></span>
            <a className={activeSection === "ask" ? "nav-active" : ""} href="#ask" onClick={() => setActiveSection("ask")}><span className="nav-icon">✦</span>Ask Vittavani</a>
            <span className="nav-unavailable" title="Account settings are not implemented"><span className="nav-icon">⚙</span>Settings<small>Later</small></span>
            <a className={activeSection === "stock-movements" ? "nav-active" : ""} href="#stock-movements" onClick={() => setActiveSection("stock-movements")}><span className="nav-icon">↕</span>Stock movements</a>
          </nav>
          <div className="sidebar-assistant">
            <div className="sidebar-assistant-icon">✦</div>
            <strong>Business, by voice</strong>
            <p>Ask about real stock in English, Hindi, or Hinglish.</p>
            <a href="#ask" onClick={() => setActiveSection("ask")}>Ask Vittavani <span aria-hidden="true">→</span></a>
          </div>
          <div className="sidebar-footer"><span className="sidebar-footer-mark">வி</span><span><strong>Vittavani</strong><small>by Vinayaka Services</small></span></div>
        </aside>
        <div className="workspace">
      <section className="dashboard-section" id="dashboard" aria-labelledby="dashboard-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR BUSINESS AT A GLANCE</p>
            <h1 id="dashboard-title">Good day<span className="heading-dot">.</span></h1>
            <p className="intro">Here’s what’s happening in your inventory today.</p>
          </div>
          <button className="refresh-button" type="button" onClick={() => void loadDashboard()} disabled={dashboardLoading}>
            {dashboardLoading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>

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
        {!dashboardLoading && !dashboardError && dashboard && (dashboard.product_count > 0 || (!inventoryLoading && !inventoryError && products.length > 0)) && (
          <>
            <div className="metrics-grid" aria-label="Inventory summary">
              <Metric label="Active products" value={String(activeProductCount)} detail="Products in your catalogue" icon="▤" tone="green" />
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
                <a className="quick-action action-green" href="#stock-entry" onClick={() => { setStockMode("receipt"); setActiveSection("inventory"); }}><span>＋</span><strong>Receive stock</strong><small>Record incoming items</small></a>
                <a className="quick-action action-blue" href="#stock-entry" onClick={() => { setStockMode("transfer"); setActiveSection("inventory"); }}><span>⇄</span><strong>Transfer stock</strong><small>Move between locations</small></a>
                <a className="quick-action action-purple" href="#product-form-title" onClick={() => setActiveSection("inventory")}><span>▤</span><strong>Add product</strong><small>Grow your catalogue</small></a>
                <a className="quick-action action-orange" href="#ask" onClick={() => setActiveSection("ask")}><span>✦</span><strong>Ask Vittavani</strong><small>Speak or type a question</small></a>
              </div>
              <p className="feature-boundary">Sales, customer udhar, payments, purchases, and expenses aren’t enabled yet—no sample figures are shown.</p>
            </section>
            <div className="dashboard-columns">
              <section className="data-card" id="stock-alerts" aria-labelledby="low-stock-title">
                <div className="card-heading">
                  <div>
                    <h2 id="low-stock-title">Stock alerts</h2>
                    <p>Low and out-of-stock products to review</p>
                  </div>
                  <span className="count-pill">{dashboard.low_stock_count + dashboard.out_of_stock_count}</span>
                </div>
                {stockAlertRows.length === 0 ? (
                  <p className="card-empty">No low-stock alerts. Products without a configured minimum are not counted.</p>
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
                  {dashboard.recent_stock_activity.map((movement) => (
                    <li key={movement.id}>
                      <span>
                        <strong>{movement.product_name} <span className="movement-type">{movementLabel(movement.movement_type)}</span></strong>
                        <small>
                          {movement.source_location ? `${movement.source_location} → ` : ""}
                          {movement.destination_location ?? movement.source_location ?? "Location not recorded"}
                        </small>
                        <small>{new Date(movement.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small>
                      </span>
                      <span className={`movement-quantity movement-${movement.movement_type.startsWith("transfer") ? "transfer" : movement.movement_type === "purchase_receipt" ? "received" : "adjustment"}`}>{movement.movement_type.startsWith("transfer") ? "⇄ " : movement.movement_type === "purchase_receipt" ? "＋ " : "↕ "}{movement.display_quantity}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </section>

      <section className="inventory-section" id="inventory" aria-labelledby="inventory-title">
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

      <section className="inventory-section auxiliary-section" id="locations" aria-labelledby="locations-title">
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

      <section className="inventory-section auxiliary-section" id="stock-movements" aria-labelledby="stock-movements-title">
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
            <div className="movement-table" role="table" aria-label="Stock movement history">
              <div className="movement-row movement-header" role="row"><span>Product / movement</span><span>Quantity</span><span>Route / note</span><span>Recorded</span></div>
              {stockMovements.map((movement) => <div className="movement-row" role="row" key={movement.id}>
                <span><strong>{movement.product_name}</strong><small>{movementLabel(movement.movement_type)}</small></span>
                <span className="stock-quantity">{movement.display_quantity}</span>
                <span><small>{movement.source_location ? `${movement.source_location} → ` : ""}{movement.destination_location ?? movement.source_location ?? "Location not recorded"}{movement.note ? ` · ${movement.note}` : ""}</small></span>
                <time dateTime={movement.created_at}>{new Date(movement.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
              </div>)}
            </div>
          </div>
        )}
      </section>

      <section className="ask-section" id="ask" aria-labelledby="welcome-title">
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
              ? "Normal Search uses deterministic product and alias matching; no AI service is required."
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
            <span className="text-hint" role="status">
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
