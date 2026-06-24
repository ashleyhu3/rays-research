'use strict';

/**
 * LSEG Workspace / Refinitiv Data Platform (RDP) REST API — earnings transcript fetcher.
 *
 * Auth: OAuth2 client_credentials with LSEGWORKSPACE_API_KEY as client_id.
 * Endpoints:
 *   POST https://api.refinitiv.com/auth/oauth2/v1/token  → access_token
 *   GET  https://api.refinitiv.com/data/news/v1/headlines  → transcript headlines
 *   GET  https://api.refinitiv.com/data/news/v1/story/:id  → full transcript text
 */

const AUTH_URL    = 'https://api.refinitiv.com/auth/oauth2/v1/token';
const SEARCH_URL  = 'https://api.refinitiv.com/data/news/v1/headlines';
const STORY_URL   = 'https://api.refinitiv.com/data/news/v1/story';

// Token is valid ~5 min; cache it so bulk backfills don't hammer auth.
let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry - 30_000) return _token;

  const apiKey = process.env.LSEGWORKSPACE_API_KEY;
  if (!apiKey) throw new Error('LSEGWORKSPACE_API_KEY is not set in environment');

  const resp = await fetch(AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Basic auth: base64(clientId:)  — no client_secret for app-key flows
      'Authorization': `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'trapi',
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`LSEG auth ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = await resp.json();
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in ?? 300) * 1000;
  return _token;
}

/**
 * Search for earnings call transcripts for a given ticker and date range.
 *
 * LSEG category code N2:EARNCAL = StreetEvents earnings calls.
 * Returns array of headline objects: { storyId, headline, firstCreated, ... }
 */
async function searchEarningsTranscripts(ticker, { after, before, count = 20 } = {}) {
  const token = await getToken();

  const params = new URLSearchParams({
    query: `${ticker} earnings call`,
    filter: 'categories:N2:EARNCAL',
    count: String(count),
    sortBy: 'date:desc',
  });
  if (after && before) params.set('dateRange', `${after}T00:00:00Z-${before}T23:59:59Z`);

  const resp = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`LSEG search ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = await resp.json();
  // RDP wraps results in data.data or data.headlines depending on API version
  return data.data ?? data.headlines ?? [];
}

/**
 * Fetch the full text of a single transcript story by its LSEG story ID.
 * Returns the raw text string (HTML or plain text depending on content type).
 */
async function getStoryText(storyId) {
  const token = await getToken();

  const resp = await fetch(`${STORY_URL}/${encodeURIComponent(storyId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Prefer-Format': 'text/plain',
    },
    signal: AbortSignal.timeout(60_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`LSEG story ${storyId} — ${resp.status}: ${body.slice(0, 300)}`);
  }

  const data = await resp.json();

  // Try several paths the RDP API uses across versions
  const inline = data.newsItem?.contentSet?.inlineData;
  if (Array.isArray(inline) && inline.length) return String(inline[0]?.$ ?? inline[0] ?? '');
  if (typeof data.story === 'string') return data.story;
  if (typeof data.bodyXml === 'string') return data.bodyXml.replace(/<[^>]+>/g, ' ');
  // Fallback: stringify whatever we got so the caller can inspect it
  return JSON.stringify(data).slice(0, 5000);
}

/**
 * High-level: fetch all earnings transcripts for a ticker in a date window.
 * Returns array of { storyId, headline, date, rawText }.
 */
async function fetchTranscriptsForTicker(ticker, { after, before } = {}) {
  const headlines = await searchEarningsTranscripts(ticker, { after, before });
  if (!headlines.length) return [];

  const results = [];
  for (const h of headlines) {
    const storyId = h.storyId ?? h.id ?? h.guid;
    if (!storyId) continue;
    try {
      const rawText = await getStoryText(storyId);
      results.push({
        storyId,
        headline: h.headline ?? h.title ?? '',
        date: h.firstCreated ?? h.date ?? null,
        rawText,
      });
    } catch (e) {
      console.warn(`[lseg] ${ticker} story ${storyId}: ${e.message}`);
    }
    // Polite pacing — LSEG RDP free tier allows ~5 req/s
    await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

module.exports = { fetchTranscriptsForTicker, searchEarningsTranscripts, getStoryText };
