import Link from "next/link";

type PublicHeaderProps = {
  variant?: "home" | "login" | "signup";
};

const navigation = [
  ["Features", "features"],
  ["How it works", "how-it-works"],
  ["For Indian businesses", "for-businesses"],
  ["Pricing", "pricing"],
  ["FAQ", "faq"],
];

export function PublicHeader({ variant = "home" }: PublicHeaderProps) {
  const isHome = variant === "home";
  const authHref = variant === "login" ? "/signup" : "/login";
  const authLabel = variant === "login" ? "Create account" : "Log in";
  const sectionHref = (section: string) => isHome ? `#${section}` : `/#${section}`;

  return (
    <header className="public-header">
      <Link className="public-brand" href="/" aria-label="Vittavani home">
        <span className="public-brand-mark" aria-hidden="true">வி</span>
        <span>Vittavani</span>
      </Link>
      <nav aria-label="Main navigation" className="public-nav">
        {navigation.map(([label, section]) => (
          <Link href={sectionHref(section)} key={section}>{label}</Link>
        ))}
      </nav>
      <div className="public-header-actions">
        {isHome ? (
          <>
            <Link className="public-login-link" href="/login">Log In</Link>
            <Link className="button button-primary" href="/signup">Get Started <span aria-hidden="true">→</span></Link>
          </>
        ) : (
          <Link
            className={variant === "login" ? "button button-primary" : "public-login-link"}
            href={authHref}
          >
            {variant === "home" ? "Get Started" : authLabel}
          </Link>
        )}
      </div>
      <details className="public-mobile-menu">
        <summary aria-label="Open navigation menu"><span aria-hidden="true">☰</span><span className="public-mobile-menu-label">Menu</span></summary>
        <nav aria-label="Mobile navigation">
          {navigation.map(([label, section]) => (
            <Link href={sectionHref(section)} key={section}>{label}</Link>
          ))}
          {isHome ? (
            <>
              <Link href="/login">Log In</Link>
              <Link className="public-mobile-signup" href="/signup">Get Started <span aria-hidden="true">→</span></Link>
            </>
          ) : (
            <Link className={variant === "login" ? "public-mobile-signup" : undefined} href={authHref}>{authLabel}</Link>
          )}
        </nav>
      </details>
    </header>
  );
}
