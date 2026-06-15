# Options proxy

A one-function Vercel app that fetches Yahoo Finance options chains and returns
them as raw JSON. The dashboard's Render service calls this instead of hitting
Yahoo directly, because Yahoo rate-limits (429s) Render's shared datacenter
egress IPs. Vercel's IP pool isn't throttled the same way, so the chain loads.

```
Render app  ──►  this proxy (clean IP)  ──►  Yahoo Finance
            ◄──  raw chain JSON         ◄──
```

The Render app does all the formatting; this just relays the raw chain. Auth is
an optional shared secret (`PROXY_SECRET`) checked against the `x-proxy-key`
request header.

## Deploy (one time, free tier)

> ⚠️ Only this `proxy/` folder goes on Vercel. The dashboard itself is an
> Express app (it serves `/api/*` and generates its HTML from the Vite manifest
> at runtime — there is no `index.html`), so it runs on Render, **not** Vercel.
> If Vercel runs `vite build` and fails with *"Could not resolve entry module
> index.html"*, it's building the repo root instead of `proxy/` — fix the Root
> Directory (step 3).

1. Push this repo to GitHub (the `proxy/` directory must be included).
2. In Vercel: **Add New… → Project → import this repo**.
3. **Set Root Directory to `proxy`** — this is the critical step. On the import
   screen, find **Root Directory → Edit → select `proxy`**. (Existing project:
   Settings → General → Root Directory → `proxy` → Save, then redeploy.) This
   makes Vercel deploy only this folder. It has no build step — `framework` is
   pinned to `null` in `vercel.json` and the `api/` function is auto-detected.
4. (Recommended) Settings → **Environment Variables** → add `PROXY_SECRET` to a
   value of your choice.
5. Deploy. Your endpoint is `https://<project>.vercel.app/api/options`.

## Wire up Render

On the Render service, set:

- `OPTIONS_PROXY_URL` = `https://<project>.vercel.app/api/options`
- `PROXY_SECRET` = the same value you set on Vercel (omit if you skipped it)

Redeploy Render (or let it pick up the env change). Done — the options page now
loads through the proxy.

## Test it

```bash
# without a secret
curl "https://<project>.vercel.app/api/options?ticker=NVDA"

# with a secret
curl -H "x-proxy-key: YOUR_SECRET" "https://<project>.vercel.app/api/options?ticker=NVDA"
```

A JSON chain (with `expirationDates`, `quote`, `options`) means it works. A
`503 {"error":"...429..."}` means Yahoo throttled even Vercel that moment —
retry shortly. A `401` means the secret doesn't match.
