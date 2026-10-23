import Link from "next/link";

const features = [
  {
    title: "Inventory at a glance",
    description: "See product balances, low stock, and recent stock activity from your workspace.",
  },
  {
    title: "Remember every location",
    description: "Organize storerooms, racks, and shelves, then look up where a product is kept.",
  },
  {
    title: "Manage stock and sales",
    description: "Record receipts, adjustments, transfers, sales, and customer account activity.",
  },
  {
    title: "Ask in your own words",
    description: "Use typed questions or supported browser speech in English, Hindi, or Hinglish.",
  },
];

export default function HomePage() {
  return (
    <main className="public-page">
      <header className="public-header">
        <Link className="public-brand" href="/" aria-label="Vittavani home">
          <span className="public-brand-mark" aria-hidden="true">வி</span>
          Vittavani
        </Link>
        <nav aria-label="Main navigation" className="public-nav">
          <Link href="/login">Log In</Link>
          <Link className="button button-primary" href="/signup">Get Started</Link>
        </nav>
      </header>
      <section className="public-hero">
        <div className="public-hero-copy">
          <p className="public-eyebrow">A product of Vinayaka Services</p>
          <h1>Run your business by simply asking.</h1>
          <p className="public-lead">
            Find stock, remember product locations, record sales, and track customer accounts
            with natural language—by voice or text.
          </p>
          <div className="public-actions">
            <Link className="button button-primary" href="/signup">Get Started <span aria-hidden="true">→</span></Link>
            <Link className="button button-secondary" href="/login">Log In</Link>
          </div>
          <p className="public-note">Designed for the everyday work of Indian small businesses.</p>
        </div>
        <div className="public-hero-card" aria-label="Example of a business question">
          <div className="public-card-top"><span className="public-card-spark">✦</span><span>Ask Vittavani</span><span className="public-live-dot" /></div>
          <p className="public-query">“Where did I keep this product?”</p>
          <div className="public-answer">
            <span className="public-answer-label">YOUR BUSINESS DATA</span>
            <strong>Find stock and locations</strong>
            <small>Answers come from the inventory in your own workspace.</small>
          </div>
          <p className="public-card-caption">Answers are based on your business data.</p>
        </div>
      </section>
      <section className="public-features" aria-labelledby="features-heading">
        <div className="public-section-heading">
          <p className="public-eyebrow">LESS TAPPING, MORE DOING</p>
          <h2 id="features-heading">The details of your business, easier to manage.</h2>
        </div>
        <div className="public-feature-grid">
          {features.map((feature, index) => (
            <article className="public-feature-card" key={feature.title}>
              <span className="public-feature-index">0{index + 1}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="public-cta">
        <div>
          <p className="public-eyebrow">YOUR BUSINESS, YOUR WORKSPACE</p>
          <h2>Make everyday operations simpler.</h2>
        </div>
        <Link className="button button-primary" href="/signup">Create your workspace <span aria-hidden="true">→</span></Link>
      </section>
      <footer className="public-footer">
        <span>Vittavani · A product of Vinayaka Services</span>
        <span>Built for small businesses, wholesalers, and retailers.</span>
      </footer>
    </main>
  );
}
