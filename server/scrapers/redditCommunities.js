const axios = require('axios');

// Subreddit size and activity via the public about.json endpoint —
// subscribers + currently-active users, the real community-growth signal
// (search-result post counts are capped and noisy).
const SUBREDDITS = ['ChatGPT', 'ClaudeAI', 'LocalLLaMA', 'singularity', 'OpenAI'];

const UA = 'signal-dashboard/1.0 (research; public about.json only)';

async function fetchSub(name) {
  // Primary: about.json (has active-user count). Some datacenter IPs get
  // 403'd here while search.json still works, so fall back to reading the
  // subreddit_subscribers field carried on search results.
  try {
    const { data } = await axios.get(`https://www.reddit.com/r/${name}/about.json`, {
      headers: { 'User-Agent': UA },
      timeout: 12000,
    });
    const d = data?.data ?? {};
    if (d.subscribers != null) {
      return { subscribers: d.subscribers, activeUsers: d.active_user_count ?? null };
    }
  } catch { /* fall through */ }

  const { data } = await axios.get(
    `https://www.reddit.com/search.json?q=${encodeURIComponent(`subreddit:${name}`)}&limit=1`,
    { headers: { 'User-Agent': UA }, timeout: 12000 }
  );
  const post = data?.data?.children?.[0]?.data;
  if (post?.subreddit_subscribers == null) throw new Error(`no data for r/${name}`);
  return { subscribers: post.subreddit_subscribers, activeUsers: null };
}

async function getRedditCommunities() {
  const results = await Promise.allSettled(SUBREDDITS.map(fetchSub));
  const subs = {};
  SUBREDDITS.forEach((name, i) => {
    subs[name] = results[i].status === 'fulfilled' ? results[i].value : null;
  });
  if (Object.values(subs).every(v => v == null)) return null;
  return { subs, asOf: new Date().toISOString().slice(0, 10) };
}

module.exports = { getRedditCommunities };
