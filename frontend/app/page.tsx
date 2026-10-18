"use client";

import { FormEvent, useState } from "react";

type Answer = {
  message: string;
  original_query: string;
  clarification_required: boolean;
  candidates: string[];
};

const examples = ["Amul butter kahan rakha hai?", "अमूल बटर कितना बचा है?", "Show low stock items."];

export default function Home() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setAnswer(null);
    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.NEXT_PUBLIC_DEV_API_TOKEN
            ? { "X-Dev-Token": process.env.NEXT_PUBLIC_DEV_API_TOKEN }
            : {}),
        },
        body: JSON.stringify({ query }),
      });
      if (!response.ok) {
        throw new Error(response.status === 401 ? "Development API token is missing or invalid." : "Could not reach Vittavani. Check that the API is running.");
      }
      setAnswer((await response.json()) as Answer);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Vittavani home">
          <span className="brand-mark" aria-hidden="true">வ</span>
          <span>Vittavani</span>
        </a>
        <span className="company">A product of Vinayaka Services</span>
      </header>
      <section className="hero" aria-labelledby="welcome-title">
        <p className="eyebrow">YOUR BUSINESS, IN YOUR WORDS</p>
        <h1 id="welcome-title">How can I help your business today?</h1>
        <p className="intro">Ask about your products in English, Hindi, or Hinglish.</p>
        <form className="ask-card" onSubmit={submit}>
          <label htmlFor="business-query">Ask Vittavani</label>
          <textarea
            id="business-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try “Amul butter kahan rakha hai?”"
            rows={3}
            maxLength={500}
            required
          />
          <div className="ask-footer">
            <span className="text-hint">Type a question to search your stock</span>
            <button className="submit" type="submit" disabled={loading || !query.trim()}>
              {loading ? "Checking…" : "Ask"}
              <span aria-hidden="true"> →</span>
            </button>
          </div>
        </form>
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
          </section>
        )}
      </section>
      <footer className="footer">A product of Vinayaka Services</footer>
    </main>
  );
}
