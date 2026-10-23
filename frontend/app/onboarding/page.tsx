"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export default function OnboardingPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const name = new FormData(event.currentTarget).get("businessName");
    try {
      const response = await fetch("/api/v1/business", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload.detail === "string" ? payload.detail : "Workspace could not be created.");
      }
      router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workspace could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="onboarding-title">
        <Link className="public-brand auth-brand" href="/">
          <span className="public-brand-mark" aria-hidden="true">வி</span>
          Vittavani
        </Link>
        <p className="public-eyebrow">ONE LAST STEP</p>
        <h1 id="onboarding-title">Set up your business</h1>
        <p className="auth-description">Create your private workspace. Your business data stays separate from other businesses.</p>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="business-name">Business name</label>
          <input id="business-name" name="businessName" type="text" required minLength={1} maxLength={160} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={submitting} type="submit">
            {submitting ? "Creating workspace…" : "Create workspace"}
          </button>
        </form>
      </section>
    </main>
  );
}
