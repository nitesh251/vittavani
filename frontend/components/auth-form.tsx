"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isSignup = mode === "signup";

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "verification") {
      setError("That email verification link could not be completed. Request a new link and try again.");
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    const client = getSupabaseBrowserClient();
    if (!client) {
      setError("Authentication is not configured. Add the Supabase project URL and public key to frontend/.env.local.");
      return;
    }
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    const confirmPassword = String(values.get("confirm-password") ?? "");
    if (isSignup && password !== confirmPassword) {
      setError("Passwords do not match. Check both fields and try again.");
      return;
    }
    setSubmitting(true);
    try {
      const result = isSignup
        ? await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
        })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) {
        const normalizedError = result.error.message.toLocaleLowerCase();
        setError(
          normalizedError.includes("invalid login credentials")
            ? "The email or password is incorrect. Check your details and try again."
            : normalizedError.includes("email not confirmed")
              ? "Verify your email before logging in."
              : normalizedError.includes("too many requests")
                ? "Too many attempts. Wait a moment and try again."
                : isSignup && normalizedError.includes("already registered")
                  ? "An account already exists for this email. Try logging in instead."
                  : isSignup
                    ? "Your account could not be created. Check your details and try again."
                    : "You could not be signed in. Check your details and try again.",
        );
      } else if (isSignup && !result.data.session) {
        setMessage("Check your email to verify your account, then return here to log in.");
      } else {
        router.replace(isSignup ? "/onboarding" : "/dashboard");
        router.refresh();
      }
    } catch {
      setError("Authentication could not be completed. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page auth-page-auth">
      <section className="signup-intro" aria-label="About Vittavani">
        <Link className="brand auth-brand" href="/">
          <span className="brand-mark" aria-hidden="true">வி</span>
          Vittavani
        </Link>
        <p className="eyebrow">A CLEARER VIEW OF YOUR BUSINESS</p>
        <h2>Your business, easier to manage.</h2>
        <p className="signup-intro-copy">
          Keep your inventory, sales, and business records together, with a voice-first assistant when you need it.
        </p>
        <ul className="signup-benefits">
          <li><span aria-hidden="true">✓</span> Know what stock you have and where it is stored.</li>
          <li><span aria-hidden="true">✓</span> Record sales and keep customer accounts up to date.</li>
          <li><span aria-hidden="true">✓</span> Ask business questions in the language you prefer.</li>
        </ul>
      </section>
      <section className="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title">{isSignup ? "Create your Vittavani account" : "Welcome back to Vittavani"}</h1>
        <p className="auth-description">
          {isSignup ? "Start managing your business in one place." : "Sign in to manage your business."}
        </p>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="auth-email">Email address</label>
          <input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={254} />
          <label htmlFor="auth-password">Password</label>
          <div className="auth-password-field">
            <input
              id="auth-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              minLength={8}
            />
            <button
              className="auth-password-toggle"
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-controls="auth-password"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {isSignup && <p className="auth-password-hint">Use at least 8 characters for your password.</p>}
          {isSignup && (
            <>
              <label htmlFor="auth-confirm-password">Confirm password</label>
              <input
                id="auth-confirm-password"
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
              />
            </>
          )}
          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="button button-primary auth-submit" disabled={submitting} type="submit">
            {submitting ? "Please wait…" : isSignup ? "Create account" : "Log In"}
          </button>
        </form>
        {isSignup && (
          <p className="signup-privacy-note">Your business data is kept separate from other businesses.</p>
        )}
        <p className="auth-switch">
          {isSignup ? "Already have an account? " : "New to Vittavani? "}
          <Link href={isSignup ? "/login" : "/signup"}>{isSignup ? "Log in" : "Create an account"}</Link>
        </p>
        <Link className="auth-home-link" href="/">Back to home</Link>
      </section>
    </main>
  );
}
