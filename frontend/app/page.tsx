"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
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

type InventoryProduct = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  selling_price: string;
  minimum_stock: string;
  active: boolean;
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

const examples = ["Amul butter kahan rakha hai?", "अमूल बटर कितना बचा है?", "Show low stock items."];
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

function movementLabel(value: string) {
  return value.replaceAll("_", " ");
}

function productBalanceSummary(product: InventoryProduct) {
  return product.balances.length
    ? product.balances
        .map((balance) => `${balance.location_name}: ${balance.display_quantity}`)
        .join(" · ")
    : "No location balance";
}

function productDetails(product: InventoryProduct) {
  const sku = product.sku ? `SKU ${product.sku}` : "";
  return [
    sku,
    `Selling price ₹${product.selling_price}`,
    `Minimum ${product.display_minimum_stock}`,
    productBalanceSummary(product),
  ].filter(Boolean).join(" · ");
}

function Metric({
  label,
  value,
  detail,
  warning = false,
}: {
  label: string;
  value: string;
  detail: string;
  warning?: boolean;
}) {
  return (
    <article className={`metric${warning ? " metric-warning" : ""}`}>
      <p className="metric-label">{label}</p>
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
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState("");
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
        throw new Error(response.status === 401 ? "Development API token is missing or invalid." : "Could not load inventory summary.");
      }
      setDashboard((await response.json()) as Dashboard);
    } catch (caught) {
      setDashboardError(caught instanceof Error ? caught.message : "Could not load inventory summary.");
    } finally {
      setDashboardLoading(false);
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
      if (!productResponse.ok || !locationResponse.ok) {
        const failed = !productResponse.ok ? productResponse : locationResponse;
        throw new Error(failed.status === 401 ? "Development API token is missing or invalid." : "Could not load products and locations.");
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
    setSpeakAnswers(window.localStorage.getItem("vittavani-speak-answers") === "true");
    setSpeechOutputSupported(
      "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined",
    );
    return () => {
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, [loadDashboard, loadInventory]);

  async function writeInventory(path: string, method: "POST" | "PUT", body: object, success: string) {
    setWriting(true);
    setInventoryNotice("");
    setInventoryWriteError("");
    try {
      const response = await fetch(path, { method, headers, body: JSON.stringify(body) });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(data.detail ?? `Could not save inventory changes (${response.status}).`);
      }
      setInventoryNotice(success);
      await Promise.all([loadDashboard(), loadInventory()]);
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
        body: JSON.stringify({ query }),
      });
      if (!response.ok) {
        throw new Error(response.status === 401 ? "Development API token is missing or invalid." : "Could not reach Vittavani. Check that the API is running.");
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

  return (
    <main className="page">
      <header className="topbar">
        <a className="brand" href="#dashboard" aria-label="Vittavani dashboard">
          <span className="brand-mark" aria-hidden="true">வ</span>
          <span>Vittavani</span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#dashboard">Dashboard</a>
          <a href="#inventory">Inventory</a>
          <a href="#ask">Ask Vittavani</a>
        </nav>
        <span className="company">A product of Vinayaka Services</span>
      </header>

      <section className="dashboard-section" id="dashboard" aria-labelledby="dashboard-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR BUSINESS AT A GLANCE</p>
            <h1 id="dashboard-title">Dashboard</h1>
            <p className="intro">A live view of the inventory recorded for your business.</p>
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
              <Metric label="Products / SKUs" value={String(dashboard.product_count)} detail="Active products in your catalogue" />
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
              />
              <Metric
                label="Low stock"
                value={String(dashboard.low_stock_count)}
                detail="In-stock products at/below configured minimum"
                warning={dashboard.low_stock_count > 0}
              />
              <Metric
                label="Out of stock"
                value={String(dashboard.out_of_stock_count)}
                detail="Active products with no stock"
                warning={dashboard.out_of_stock_count > 0}
              />
            </div>
            <div className="dashboard-columns">
              <section className="data-card" aria-labelledby="low-stock-title">
                <div className="card-heading">
                  <div>
                    <h2 id="low-stock-title">Stock alerts</h2>
                    <p>In-stock products at or below their set minimum</p>
                  </div>
                  <span className="count-pill">{dashboard.low_stock_count}</span>
                </div>
                {dashboard.low_stock_products.length === 0 ? (
                  <p className="card-empty">No low-stock alerts. Products without a configured minimum are not counted.</p>
                ) : (
                  <ul className="data-list">
                    {dashboard.low_stock_products.map((product) => (
                      <li key={product.id}>
                        <span><strong>{product.name}</strong><small>Minimum {product.display_minimum_stock}</small></span>
                        <span className="stock-quantity">{product.display_quantity}</span>
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
                  <h2 id="activity-title">Recent stock activity</h2>
                  <p>Latest recorded stock receipts and transfers</p>
                </div>
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
                      </span>
                      <span className="stock-quantity">{movement.display_quantity}</span>
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
                    <label>SKU (optional)<input maxLength={80} value={productForm.sku} onChange={(event) => setProductForm({ ...productForm, sku: event.target.value })} /></label>
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
                  <form className="inventory-form" onSubmit={saveStock}>
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
              {products.length === 0 ? <p className="card-empty">No products yet. Add a product above to begin building your catalogue.</p> : (
                <ul className="data-list product-list">
                  {products.map((product) => (
                    <li key={product.id}>
                      <span>
                        <strong>{product.name}{!product.active && <span className="movement-type"> · inactive</span>}</strong>
                        <small>{productDetails(product)}</small>
                      </span>
                      <span className="product-total">{product.display_quantity}</span>
                      <button className="text-button" type="button" onClick={() => editProduct(product)}>Edit</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </section>

      <section className="ask-section" id="ask" aria-labelledby="welcome-title">
        <p className="eyebrow">YOUR BUSINESS, IN YOUR WORDS</p>
        <h2 id="welcome-title">Ask Vittavani</h2>
        <p className="intro">Ask about your products in English, Hindi, or Hinglish.</p>
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
      <footer className="footer">A product of Vinayaka Services</footer>
    </main>
  );
}
