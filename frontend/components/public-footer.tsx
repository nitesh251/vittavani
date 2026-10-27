import Link from "next/link";

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <span>Vittavani · A product of Vinayaka Services</span>
      <nav aria-label="Footer navigation">
        <Link href="/#features">Features</Link>
        <Link href="/#faq">FAQ</Link>
        <Link href="/login">Log In</Link>
      </nav>
      <span>Built for small businesses, wholesalers, and retailers.</span>
    </footer>
  );
}
