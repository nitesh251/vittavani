"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { PublicHeader } from "./public-header";
import { getSupabaseBrowserClient } from "../lib/supabase/client";
import { getAuthErrorMessage } from "../lib/auth-errors.mjs";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const submittingRef = useRef(false);
  const redirectPathRef = useRef<string | null>(null);
  const redirectTimeoutRef = useRef<number | null>(null);
  const isSignup = mode === "signup";

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "verification") {
      setError("That email verification link could not be completed. Request a new link and try again.");
    }
  }, []);

  useEffect(() => {
    if (redirectPathRef.current === pathname) {
      if (redirectTimeoutRef.current !== null) window.clearTimeout(redirectTimeoutRef.current);
      redirectPathRef.current = null;
      redirectTimeoutRef.current = null;
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [pathname]);

  useEffect(() => () => {
    if (redirectTimeoutRef.current !== null) window.clearTimeout(redirectTimeoutRef.current);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    setError("");
    setMessage("");
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    const confirmPassword = String(values.get("confirm-password") ?? "");
    if (isSignup && password !== confirmPassword) {
      setError("Passwords do not match. Check both fields and try again.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    let redirecting = false;
    try {
      const client = getSupabaseBrowserClient();
      if (!client) {
        setError("Authentication is not configured. Add the Supabase project URL and public key to frontend/.env.local.");
        return;
      }
      const result = isSignup
        ? await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
        })
        : await client.auth.signInWithPassword({ email, password });
      if (result.error) {
        setError(getAuthErrorMessage(result.error, mode));
      } else if (isSignup && !result.data.session) {
        setMessage("Check your email to verify your account, then return here to log in.");
      } else {
        const destination = isSignup ? "/onboarding" : "/dashboard";
        redirectPathRef.current = destination;
        redirecting = true;
        router.replace(destination);
        router.refresh();
        redirectTimeoutRef.current = window.setTimeout(() => {
          if (redirectPathRef.current !== destination) return;
          redirectPathRef.current = null;
          redirectTimeoutRef.current = null;
          submittingRef.current = false;
          setSubmitting(false);
          setError("Your account is signed in, but the next page did not open. Try again or refresh the page.");
        }, 15_000);
      }
    } catch {
      redirecting = false;
      redirectPathRef.current = null;
      setError("Authentication could not be completed. Check your connection and try again.");
    } finally {
      if (!redirecting) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }

  return (
    <>
      <PublicHeader variant={isSignup ? "signup" : "login"} />
      <main className="auth-page auth-page-auth">
        <section className="signup-intro" aria-label="About Vittavani">
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
          <button className="button button-primary auth-submit" aria-busy={submitting} disabled={submitting} type="submit">
            {submitting && <span className="auth-spinner" aria-hidden="true" />}
            {submitting ? isSignup ? "Creating your account…" : "Signing you in…" : isSignup ? "Create account" : "Log In"}
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
    </>
  );
}
