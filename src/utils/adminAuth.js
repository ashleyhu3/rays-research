// Admin secret for write endpoints (transcripts:collect, refresh, transcript:series).
//
// The secret is never baked into the bundle — that would ship it to every
// visitor in plain text. Instead the operator enters it once in the browser;
// we stash it in localStorage and attach it as a Bearer header on admin calls.
// On a 401 the caller should clearAdminSecret() so the next attempt re-prompts.
const STORAGE_KEY = 'rays.adminSecret';

export function getAdminSecret({ prompt = true } = {}) {
  let secret = '';
  try { secret = localStorage.getItem(STORAGE_KEY) || ''; } catch { /* storage blocked */ }
  if (!secret && prompt && typeof window !== 'undefined') {
    const entered = (window.prompt('Enter the admin secret to run this action:') || '').trim();
    if (entered) {
      secret = entered;
      try { localStorage.setItem(STORAGE_KEY, secret); } catch { /* storage blocked */ }
    }
  }
  return secret;
}

export function clearAdminSecret() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ }
}

// Headers for an admin POST. Prompts for the secret if we don't have one yet.
export function adminHeaders(extra = {}) {
  const secret = getAdminSecret();
  return { ...extra, ...(secret ? { Authorization: `Bearer ${secret}` } : {}) };
}
