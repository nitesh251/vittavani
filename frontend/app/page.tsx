import Link from "next/link";

const features = [
  {
    icon: "inventory",
    title: "Inventory at a glance",
    description: "Track product balances, low-stock alerts, and recent stock movements in one workspace.",
  },
  {
    icon: "locations",
    title: "Storage locations",
    description: "Organize storerooms, racks, and shelves, then find where a product is kept.",
  },
  {
    icon: "voice",
    title: "Voice and text",
    description: "Ask questions or give supported business commands in English, Hindi, or Hinglish.",
  },
  {
    icon: "accounts",
    title: "Sales and customer accounts",
    description: "Record sales, keep customer account balances, and review transaction history.",
  },
  {
    icon: "overview",
    title: "A useful business overview",
    description: "See stock totals, low-stock counts, and recent inventory activity from saved data.",
  },
  {
    icon: "assistant",
    title: "AI-assisted questions",
    description: "Optional AI interpretation can help understand requests when a provider is configured.",
  },
];

const iconPaths: Record<string, string[]> = {
  inventory: ["M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z", "M4.5 7.8 12 12l7.5-4.2", "M12 12v9", "M8 5.2l8 4.5"],
  locations: ["M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z", "M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  voice: ["M12 3v10", "M8 7v6a4 4 0 0 0 8 0V7", "M5 12a7 7 0 0 0 14 0", "M12 19v3", "M9 22h6"],
  accounts: ["M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 19v1", "M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z", "M16 4.2a3.5 3.5 0 0 1 0 6.6", "M20 20v-1.5a4.5 4.5 0 0 0-3.2-4.3"],
  overview: ["M4 19V5", "M4 19h16", "M8 16v-5", "M12 16V8", "M16 16V4", "M20 16v-7"],
  assistant: ["m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z", "m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z"],
};

function FeatureIcon({ name }: { name: string }) {
  return (
    <span className={`public-feature-icon public-feature-icon-${name}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {iconPaths[name].map((path) => <path d={path} key={path} />)}
      </svg>
    </span>
  );
}

const faqs = [
  {
    question: "Can I use Vittavani without speaking?",
    answer: "Yes. Type a question or supported business command whenever voice input is unavailable or inconvenient.",
  },
  {
    question: "Which languages can I use?",
    answer: "The interface supports English, Hindi, and Hinglish prompts. Browser speech recognition availability and accuracy vary by device and browser.",
  },
  {
    question: "Does Vittavani require an AI provider?",
    answer: "No. Normal Search and common supported commands work without an AI provider. AI-assisted interpretation is optional and requires configuration.",
  },
];

export default function HomePage() {
  return (
    <main className="public-page">
      <header className="public-header">
        <Link className="public-brand" href="/" aria-label="Vittavani home">
          <span className="public-brand-mark" aria-hidden="true">வி</span>
          <span>Vittavani</span>
        </Link>
        <nav aria-label="Main navigation" className="public-nav">
          <Link href="#features">Features</Link>
          <Link href="#how-it-works">How it works</Link>
          <Link href="#for-businesses">For Indian businesses</Link>
          <Link href="#pricing">Pricing</Link>
          <Link href="#faq">FAQ</Link>
        </nav>
        <div className="public-header-actions">
          <Link className="public-login-link" href="/login">Log In</Link>
          <Link className="button button-primary" href="/signup">Get Started <span aria-hidden="true">→</span></Link>
        </div>
        <details className="public-mobile-menu">
          <summary aria-label="Open navigation menu"><span aria-hidden="true">☰</span><span className="public-mobile-menu-label">Menu</span></summary>
          <nav aria-label="Mobile navigation">
            <Link href="#features">Features</Link>
            <Link href="#how-it-works">How it works</Link>
            <Link href="#for-businesses">For Indian businesses</Link>
            <Link href="#pricing">Pricing</Link>
            <Link href="#faq">FAQ</Link>
            <Link href="/login">Log In</Link>
            <Link className="public-mobile-signup" href="/signup">Get Started <span aria-hidden="true">→</span></Link>
          </nav>
        </details>
      </header>

      <section className="public-hero" aria-labelledby="hero-heading">
        <div className="public-hero-copy">
          <p className="public-eyebrow"><span className="public-eyebrow-mark" aria-hidden="true">✦</span> A product of Vinayaka Services</p>
          <h1 id="hero-heading">Your business, in the <span>flow of conversation.</span></h1>
          <p className="public-lead">
            Find stock, remember product locations, record sales, and track customer accounts
            with everyday language—by voice or text.
          </p>
          <div className="public-actions">
            <Link className="button button-primary" href="/signup">Get Started <span aria-hidden="true">→</span></Link>
            <Link className="button button-secondary" href="#how-it-works"><span className="public-play-icon" aria-hidden="true">▶</span> See how it works</Link>
          </div>
          <ul className="public-benefits" aria-label="Vittavani highlights">
            <li><span aria-hidden="true">✓</span> Voice or text</li>
            <li><span aria-hidden="true">✓</span> English, Hindi &amp; Hinglish</li>
            <li><span aria-hidden="true">✓</span> Your saved business data</li>
          </ul>
          <p className="public-note">Designed for the everyday work of Indian shops, wholesalers, and distributors.</p>
        </div>

        <div className="public-hero-art">
          <div className="public-orbit public-orbit-one" aria-hidden="true" />
          <div className="public-orbit public-orbit-two" aria-hidden="true" />
          <div className="public-floating-tile public-floating-tile-top"><span aria-hidden="true">अ</span> Hindi · Hinglish · English</div>
          <div className="public-floating-tile public-floating-tile-bottom"><span aria-hidden="true">⌁</span> Speak or type</div>
          <section className="public-hero-card" aria-labelledby="assistant-preview-heading">
            <div className="public-card-top">
              <span className="public-card-spark" aria-hidden="true">✦</span>
              <div><h2 id="assistant-preview-heading">Ask Vittavani</h2><p>Voice-first business assistant</p></div>
              <span className="public-preview-label">PREVIEW</span>
            </div>
            <div className="public-chat-user">
              <span className="public-chat-avatar" aria-hidden="true">You</span>
              <p>“Where did I keep this product?”</p>
            </div>
            <div className="public-chat-answer">
              <span className="public-answer-mark" aria-hidden="true">வி</span>
              <div>
                <span className="public-answer-label">ASK ABOUT YOUR BUSINESS</span>
                <p>Look up a product’s stock and saved storage location.</p>
              </div>
            </div>
            <div className="public-preview-prompt">
              <span>Ask about stock, locations, or accounts</span>
              <span className="public-preview-mic" aria-hidden="true">⌁</span>
            </div>
            <p className="public-card-caption">Illustrative example · responses use your workspace data</p>
          </section>
          <div className="public-art-dots public-art-dots-one" aria-hidden="true">•••</div>
          <div className="public-art-dots public-art-dots-two" aria-hidden="true">••••</div>
        </div>
      </section>

      <section className="public-features" id="features" aria-labelledby="features-heading">
        <div className="public-section-heading">
          <p className="public-eyebrow">LESS TAPPING, MORE DOING</p>
          <h2 id="features-heading">Everyday business tasks, made easier.</h2>
          <p>Keep the details that matter close at hand, from stock on the shelf to customer accounts.</p>
        </div>
        <div className="public-feature-grid">
          {features.map((feature, index) => (
            <article className="public-feature-card" key={feature.title}>
              <div className="public-feature-card-top">
                <FeatureIcon name={feature.icon} />
                <span className="public-feature-index">0{index + 1}</span>
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-how" id="how-it-works" aria-labelledby="how-heading">
        <div className="public-how-intro">
          <p className="public-eyebrow">A NATURAL WAY TO GET THINGS DONE</p>
          <h2 id="how-heading">Less tapping.<br /><span>More doing.</span></h2>
          <p>Ask a question or give a supported command in the way that feels easiest. Vittavani connects the request to your saved business information.</p>
          <Link className="public-text-link" href="/signup">Try Vittavani <span aria-hidden="true">→</span></Link>
        </div>
        <div className="public-steps">
          <article className="public-step-card">
            <span className="public-step-number">01</span>
            <div><h3>Ask naturally</h3><p>Type a request or use browser speech where it is supported.</p></div>
            <span className="public-step-symbol public-step-symbol-blue" aria-hidden="true">⌁</span>
          </article>
          <article className="public-step-card">
            <span className="public-step-number">02</span>
            <div><h3>Get a useful response</h3><p>Check stock, locations, customer balances, or supported actions.</p></div>
            <span className="public-step-symbol public-step-symbol-purple" aria-hidden="true">✦</span>
          </article>
          <article className="public-step-card">
            <span className="public-step-number">03</span>
            <div><h3>Keep work together</h3><p>Review saved inventory, sales, movements, and account activity in your workspace.</p></div>
            <span className="public-step-symbol public-step-symbol-amber" aria-hidden="true">↗</span>
          </article>
        </div>
      </section>

      <section className="public-business" id="for-businesses" aria-labelledby="business-heading">
        <div className="public-business-mark" aria-hidden="true">ವಿ</div>
        <div>
          <p className="public-eyebrow">MADE FOR THE WAY YOU WORK</p>
          <h2 id="business-heading">Built around Indian small businesses.</h2>
          <p>From a neighborhood shop to a wholesale operation, keep everyday inventory and customer account tasks in one place. Use English, Hindi, or Hinglish—and type whenever speaking is not convenient.</p>
        </div>
        <div className="public-language-tags" aria-label="Supported prompt languages">
          <span>English</span><span>हिन्दी</span><span>Hinglish</span>
        </div>
      </section>

      <section className="public-pricing" id="pricing" aria-labelledby="pricing-heading">
        <div className="public-pricing-card">
          <div>
            <p className="public-eyebrow">GET STARTED WITH VITTAVANI</p>
            <h2 id="pricing-heading">A workspace for your business.</h2>
            <p>Pricing details are not published yet. Create an account to begin setting up your business workspace.</p>
          </div>
          <Link className="button button-primary" href="/signup">Create your account <span aria-hidden="true">→</span></Link>
        </div>
      </section>

      <section className="public-faq" id="faq" aria-labelledby="faq-heading">
        <div className="public-section-heading">
          <p className="public-eyebrow">GOOD TO KNOW</p>
          <h2 id="faq-heading">Frequently asked questions</h2>
        </div>
        <div className="public-faq-list">
          {faqs.map((faq) => (
            <details className="public-faq-item" key={faq.question}>
              <summary>{faq.question}<span aria-hidden="true">+</span></summary>
              <p>{faq.answer}</p>
            </details>
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
        <nav aria-label="Footer navigation"><Link href="#features">Features</Link><Link href="#faq">FAQ</Link><Link href="/login">Log In</Link></nav>
        <span>Built for small businesses, wholesalers, and retailers.</span>
      </footer>
    </main>
  );
}
