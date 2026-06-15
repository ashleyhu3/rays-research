// Serverless options-chain fetcher.
//
// Why this exists: Yahoo Finance rate-limits (429s the crumb/cookie handshake)
// requests from Render's shared datacenter egress IPs, so the dashboard's
// /api/options route fails in production even though the identical call works
// from a laptop. This function runs the Yahoo fetch from Vercel's IP pool
// (which Yahoo doesn't throttle the same way) and returns the raw chain; the
// Render app fetches from here (via OPTIONS_PROXY_URL) and does the formatting.
//
// Deploy this directory as its own Vercel project (Root Directory = proxy).
// Optional: set PROXY_SECRET on Vercel + Render so the endpoint isn't openly
// abusable — requests must then carry a matching x-proxy-key header.
import YahooFinance from 'yahoo-finance2';

// A real browser User-Agent makes the crumb/cookie handshake look like an
// ordinary page load (the library's default UA is itself throttled).
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let _yf;
function getYF() {
  if (!_yf) {
    _yf = new YahooFinance({
      suppressNotices: ['yahooSurvey'],
      fetchOptions: { headers: { 'User-Agent': BROWSER_UA } },
    });
  }
  return _yf;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Retry transient rate limits — a 429 on the crumb handshake often clears on a
// second attempt once a cookie is seeded.
async function withRetry(fn, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try { return await fn(); }
    catch (e) {
      const rateLimited = e.message?.includes('429') || /Too Many Requests|crumb/i.test(e.message ?? '');
      if (i === tries || !rateLimited) throw e;
      await sleep(1500 * i);
    }
  }
}

export default async function handler(req, res) {
  const secret = process.env.PROXY_SECRET;
  if (secret && req.headers['x-proxy-key'] !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const ticker = (req.query.ticker ?? '').toString().trim().toUpperCase();
  const date   = req.query.date ? req.query.date.toString() : null;
  if (!ticker) return res.status(400).json({ error: 'ticker required' });

  try {
    const queryOpts = date ? { date } : {};
    const chain = await withRetry(
      () => getYF().options(ticker, queryOpts, { validateResult: false })
    );
    // Let Vercel's edge cache the chain briefly — repeat lookups for the same
    // ticker don't re-hit Yahoo, which further reduces the 429 surface.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(chain);
  } catch (e) {
    const rateLimited = e.message?.includes('429') || /Too Many Requests|crumb/i.test(e.message ?? '');
    return res.status(rateLimited ? 503 : 500).json({ error: e.message ?? 'fetch failed' });
  }
}
