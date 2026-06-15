export default function Web() {
  return (
    <div style={{ padding: '32px', maxWidth: 720 }}>
      <h2 style={{ marginBottom: 12 }}>Web traffic &amp; stickiness</h2>
      <p style={{ lineHeight: 1.7, color: 'var(--ter)' }}>
        The charts that used to live here (monthly visits, session duration, bounce rate
        for chatgpt.com / claude.ai / gemini.google.com / perplexity.ai) showed
        illustrative placeholder curves, not measured data — there is no free,
        licensable source for web-traffic intelligence. SimilarWeb&apos;s API is
        paid-only and scraping it violates their terms.
      </p>
      <p style={{ lineHeight: 1.7, color: 'var(--ter)' }}>
        They have been removed rather than risk presenting fabricated numbers as
        real. For consumer-demand signals backed by real data, see Google Trends,
        Wikipedia pageviews, and the OpenRouter usage rankings views.
      </p>
    </div>
  );
}
