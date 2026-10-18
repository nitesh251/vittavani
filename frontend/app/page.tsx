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
  stock_by_unit: { unit: string; quantity: string }[];
  low_stock_count: number;
  out_of_stock_count: number;
  low_stock_products: { id: string; name: string; quantity: string; unit: string; minimum_stock: string }[];
  stock_by_location: { name: string; product_count: number; stock_by_unit: { unit: string; quantity: string }[] }[];
  recent_stock_activity: {
    movement_type: string;
    product_name: string;
    quantity: string;
    unit: string;
    source_location: string | null;
    destination_location: string | null;
    created_at: string;
  }[];
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

const examples = ["Amul butter kahan rakha hai?", "अमूल बटर कितना बचा है?", "Show low stock items."];
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const devToken =
  process.env.NODE_ENV === "development" ? process.env.NEXT_PUBLIC_DEV_API_TOKEN : undefined;
const headers = {
  "Content-Type": "application/json",
  ...(devToken ? { "X-Dev-Token": devToken } : {}),
};

function formatQuantity(value: string) {
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

function movementLabel(value: string) {
  return value.replaceAll("_", " ");
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
      const response = await fetch(`${apiUrl}/api/v1/dashboard`, { headers });
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

  useEffect(() => {
    void loadDashboard();
    setSpeakAnswers(window.localStorage.getItem("vittavani-speak-answers") === "true");
    setSpeechOutputSupported(
      "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined",
    );
    return () => {
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, [loadDashboard]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAnswer(null);
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/v1/ask`, {
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

        {dashboardLoading && <p className="dashboard-state" role="status">Loading your inventory…</p>}
        {dashboardError && (
          <div className="dashboard-state state-error" role="alert">
            <span>{dashboardError}</span>
            <button className="text-button" type="button" onClick={() => void loadDashboard()}>Try again</button>
          </div>
        )}
        {!dashboardLoading && !dashboardError && dashboard && dashboard.product_count === 0 && (
          <div className="dashboard-state empty-state">
            <strong>Your inventory is ready when you are.</strong>
            <span>No products have been added yet, so there are no stock totals or alerts to show.</span>
          </div>
        )}
        {!dashboardLoading && !dashboardError && dashboard && dashboard.product_count > 0 && (
          <>
            <div className="metrics-grid" aria-label="Inventory summary">
              <Metric label="Products / SKUs" value={String(dashboard.product_count)} detail="Active products in your catalogue" />
              <Metric
                label="Stock on hand"
                value={
                  dashboard.stock_by_unit.length === 1
                    ? `${formatQuantity(dashboard.stock_by_unit[0].quantity)} ${dashboard.stock_by_unit[0].unit}`
                    : dashboard.stock_by_unit.length > 1
                      ? "Mixed units"
                      : "0"
                }
                detail={
                  dashboard.stock_by_unit.length > 1
                    ? `${dashboard.stock_by_unit.map((stock) => `${formatQuantity(stock.quantity)} ${stock.unit}`).join(" · ")} — units kept separate`
                    : dashboard.stock_by_unit.length === 1
                      ? "On hand across recorded locations"
                      : "No stock currently recorded"
                }
              />
              <Metric
                label="Low stock"
                value={String(dashboard.low_stock_count)}
                detail="At or below configured minimum"
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
                    <p>Products at or below their set minimum</p>
                  </div>
                  <span className="count-pill">{dashboard.low_stock_count}</span>
                </div>
                {dashboard.low_stock_products.length === 0 ? (
                  <p className="card-empty">No low-stock alerts. Products without a configured minimum are not counted.</p>
                ) : (
                  <ul className="data-list">
                    {dashboard.low_stock_products.map((product) => (
                      <li key={product.id}>
                        <span><strong>{product.name}</strong><small>Minimum {formatQuantity(product.minimum_stock)} {product.unit}</small></span>
                        <span className="stock-quantity">{formatQuantity(product.quantity)} {product.unit}</span>
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
                      <li key={location.name}>
                        <span><strong>{location.name}</strong><small>{location.product_count} {location.product_count === 1 ? "product" : "products"}</small></span>
                        <span className="stock-quantity">{location.stock_by_unit.map((stock) => `${formatQuantity(stock.quantity)} ${stock.unit}`).join(" · ") || "0 units"}</span>
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
                  {dashboard.recent_stock_activity.map((movement, index) => (
                    <li key={`${movement.created_at}-${index}`}>
                      <span>
                        <strong>{movement.product_name} <span className="movement-type">{movementLabel(movement.movement_type)}</span></strong>
                        <small>
                          {movement.source_location ? `${movement.source_location} → ` : ""}
                          {movement.destination_location ?? movement.source_location ?? "Location not recorded"}
                        </small>
                      </span>
                      <span className="stock-quantity">{formatQuantity(movement.quantity)} {movement.unit}</span>
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
