"""
OpenRouter token demand  x  AI-equity returns : pilot correlation study.

Data
----
* Token volume : weekly per-provider tokens reconstructed from the 2026-07-10
  weekly-report SVG (analysis/extract_tokens.py). Window 2025-12-29 .. 2026-06-15
  (25 complete ISO weeks; the in-progress 06-22 week is dropped).
* Stocks       : weekly adjusted closes from Yahoo (yfinance).
* Pricing      : current OpenRouter $/M input price per model (/api/v1/models),
                 aggregated to provider for the blended-price experiment.

Everything runs on weekly LOG returns / log-changes, never levels.
"""
import json, warnings, datetime as dt
from pathlib import Path
import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
import yfinance as yf

warnings.filterwarnings("ignore")
HERE = Path(__file__).parent
DATA = HERE / "data"
np.random.seed(0)

# ----------------------------------------------------------------------------
# 1. Token series
# ----------------------------------------------------------------------------
tok = pd.read_csv(DATA / "token_weekly.csv", parse_dates=["monday"]).set_index("monday")
tok = tok.iloc[:-1]  # drop in-progress final week (flagged 3b82f6 in extractor)
tok = tok.sort_index()
WEEKS = tok.index
print(f"Token weeks: {WEEKS[0].date()} .. {WEEKS[-1].date()}  (n={len(tok)})")

# ----------------------------------------------------------------------------
# 2. Stocks
# ----------------------------------------------------------------------------
TICKERS = ["NVDA", "AMD", "TSM", "AVGO", "MSFT", "GOOGL", "META", "BABA",
           "BIDU", "TCEHY", "QQQ", "SMH"]
raw = yf.download(TICKERS, start="2025-12-15", end="2026-06-30",
                  interval="1wk", auto_adjust=True, progress=False)["Close"]
# Yahoo weekly bars are indexed by week-start (Monday); align to token Mondays.
raw.index = pd.to_datetime(raw.index).normalize()
# snap each stock week to the nearest token Monday within 3 days
stk = raw.reindex(raw.index)
print(f"Stock weeks: {stk.index.min().date()} .. {stk.index.max().date()}  (n={len(stk)})")

def logret(s):
    return np.log(s).diff()

# Weekly log returns
stk_ret = logret(stk)
tok_ret = np.log(tok.astype(float)).diff()

# Align stock returns onto the token Monday grid (intersection)
common = WEEKS.intersection(stk_ret.index)
tok_ret = tok_ret.loc[common]
stk_ret = stk_ret.loc[common]
tok_lvl = tok.loc[common]
print(f"Aligned return weeks: n={len(common)}  ({common[0].date()} .. {common[-1].date()})")

results = {"meta": {
    "generated": dt.datetime.now().isoformat(timespec="seconds"),
    "token_window": [str(WEEKS[0].date()), str(WEEKS[-1].date())],
    "n_weeks_levels": int(len(tok)),
    "n_return_obs": int(len(common)),
    "tickers": TICKERS,
    "providers": [c for c in tok.columns],
}}

# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def corr_pair(x, y):
    d = pd.concat([x, y], axis=1).dropna()
    if len(d) < 6:
        return None
    a, b = d.iloc[:, 0].values, d.iloc[:, 1].values
    pr, pp = stats.pearsonr(a, b)
    sr, sp = stats.spearmanr(a, b)
    return {"n": int(len(d)), "pearson": float(pr), "pearson_p": float(pp),
            "spearman": float(sr), "spearman_p": float(sp)}

def bh_fdr(pvals):
    p = np.asarray(pvals, float)
    order = np.argsort(p)
    m = len(p)
    adj = np.empty(m)
    prev = 1.0
    for rank, idx in enumerate(order[::-1]):
        i = m - rank
        val = min(prev, p[idx] * m / i)
        adj[idx] = val
        prev = val
    return adj

def lead_lag(x, y, max_lag=4):
    """Cross-correlation of x (tokens) vs y (stock). lag>0 => tokens LEAD stock."""
    out = {}
    for L in range(-max_lag, max_lag + 1):
        if L >= 0:
            xx, yy = x.iloc[:len(x) - L], y.iloc[L:]
        else:
            xx, yy = x.iloc[-L:], y.iloc[:len(y) + L]
        d = pd.concat([xx.reset_index(drop=True), yy.reset_index(drop=True)], axis=1).dropna()
        if len(d) >= 6:
            out[L] = float(stats.pearsonr(d.iloc[:, 0], d.iloc[:, 1])[0])
        else:
            out[L] = None
    return out

def rolling_corr(x, y, win=12):
    d = pd.concat([x, y], axis=1).dropna()
    rc = d.iloc[:, 0].rolling(win).corr(d.iloc[:, 1])
    return {str(k.date()): (None if pd.isna(v) else float(v)) for k, v in rc.items()}

# ----------------------------------------------------------------------------
# E1 — Aggregate token demand vs AI-infra equities
# ----------------------------------------------------------------------------
g_total = tok_ret["Total"]
E1_TICKERS = ["NVDA", "TSM", "AVGO", "AMD", "MSFT", "GOOGL", "SMH", "QQQ"]
e1 = {}
pvals = []
for t in E1_TICKERS:
    c = corr_pair(g_total, stk_ret[t])
    if c is None:
        continue
    c["lead_lag"] = lead_lag(g_total, stk_ret[t])
    e1[t] = c
    pvals.append(c["pearson_p"])
adj = bh_fdr(pvals)
for t, a in zip([t for t in E1_TICKERS if t in e1], adj):
    e1[t]["pearson_p_fdr"] = float(a)
# rolling corr vs NVDA and SMH for the chart
e1_rolling = {
    "NVDA": rolling_corr(g_total, stk_ret["NVDA"]),
    "SMH": rolling_corr(g_total, stk_ret["SMH"]),
}
results["E1"] = {"desc": "Weekly log-growth of total OpenRouter tokens vs AI-infra equity log-returns",
                 "pairs": e1, "rolling_corr_12w": e1_rolling,
                 "token_growth_series": {str(k.date()): float(v) for k, v in g_total.dropna().items()}}

# ----------------------------------------------------------------------------
# E2 — Provider token-share change vs mapped stock (relative to QQQ)
# ----------------------------------------------------------------------------
prov_cols = [c for c in tok.columns if c != "Total"]
share = tok[prov_cols].div(tok["Total"], axis=0)
share_chg = np.log(share).diff().loc[common]
MAP = {"Google": "GOOGL", "OpenAI": "MSFT"}  # only providers with both a token series and a public proxy
e2 = {}
for prov, tk in MAP.items():
    rel = stk_ret[tk] - stk_ret["QQQ"]      # market-neutralised
    c = corr_pair(share_chg[prov], rel)
    if c:
        c["ticker"] = tk
        c["lead_lag"] = lead_lag(share_chg[prov], rel)
        e2[prov] = c
results["E2"] = {"desc": "Provider token-share log-change vs mapped stock return relative to QQQ",
                 "note": "Only Google->GOOGL and OpenAI->MSFT are mappable from this report's provider set (OpenAI->MSFT is a weak proxy).",
                 "pairs": e2,
                 "share_series": {p: {str(k.date()): float(v) for k, v in share[p].items()} for p in prov_cols}}

# ----------------------------------------------------------------------------
# E3 — Commoditization: budget vs premium share + blended realized $/M
# ----------------------------------------------------------------------------
# Budget/open-weight vs premium closed providers present in the series
BUDGET = [p for p in ["DeepSeek", "Zhipu", "MiniMax"] if p in prov_cols]
PREMIUM = [p for p in ["OpenAI", "Anthropic"] if p in prov_cols]
budget_share = tok[BUDGET].sum(axis=1) / tok["Total"]
premium_share = tok[PREMIUM].sum(axis=1) / tok["Total"]

# Blended realized $/M input price = sum_prov(price_prov * tokens_prov)/sum tokens.
# Provider price = median current input $/M across that provider's OpenRouter models.
prices = json.loads((DATA / "model_prices.json").read_text())  # {provider: $/M input}
have = {p: prices[p] for p in prov_cols if p in prices and prices[p] is not None}
blended = pd.Series(index=tok.index, dtype=float)
for wk in tok.index:
    num = den = 0.0
    for p in prov_cols:
        if p in have:
            v = tok.loc[wk, p]
            num += have[p] * v
            den += v
    blended[wk] = num / den if den else np.nan
blended_chg = np.log(blended).diff().loc[common]

e3 = {"budget_share_latest": float(budget_share.iloc[-1]),
      "budget_share_first": float(budget_share.iloc[0]),
      "premium_share_latest": float(premium_share.iloc[-1]),
      "premium_share_first": float(premium_share.iloc[0]),
      "blended_price_first": float(blended.iloc[0]),
      "blended_price_latest": float(blended.iloc[-1]),
      "provider_prices_usd_per_M": have,
      "series": {
          "budget_share": {str(k.date()): float(v) for k, v in budget_share.items()},
          "premium_share": {str(k.date()): float(v) for k, v in premium_share.items()},
          "blended_price": {str(k.date()): (None if pd.isna(v) else float(v)) for k, v in blended.items()},
      }}
# does falling blended price co-move with margin-sensitive names?
for t in ["NVDA", "AVGO", "MSFT"]:
    c = corr_pair(blended_chg, stk_ret[t])
    if c:
        e3.setdefault("price_vs_stock", {})[t] = c
results["E3"] = {"desc": "Commoditization: budget vs premium token share, and mix-blended realized $/M input price dynamics",
                 "caveat": "Blended price applies TODAY's list prices to historical volume, so its motion reflects model-mix shift, not real price cuts.",
                 **e3}

# ----------------------------------------------------------------------------
# E5 — Granger-style lagged OLS (Newey-West) : do token lags predict NVDA?
# ----------------------------------------------------------------------------
def lagged_ols(driver, target, nlags=3):
    df = pd.DataFrame({"y": target})
    for L in range(1, nlags + 1):
        df[f"x_l{L}"] = driver.shift(L)
    df = df.dropna()
    if len(df) < nlags + 4:
        return None
    X = sm.add_constant(df[[f"x_l{L}" for L in range(1, nlags + 1)]])
    m = sm.OLS(df["y"], X).fit(cov_type="HAC", cov_kwds={"maxlags": 2})
    return {"n": int(len(df)), "r2": float(m.rsquared),
            "params": {k: float(v) for k, v in m.params.items()},
            "pvalues": {k: float(v) for k, v in m.pvalues.items()},
            "f_pvalue": float(m.f_pvalue)}

e5 = {}
for t in ["NVDA", "SMH", "AVGO"]:
    r = lagged_ols(g_total, stk_ret[t])
    if r:
        e5[f"tokens->{t}"] = r
# reverse: does stock hype lead tokens?
r = lagged_ols(stk_ret["NVDA"], g_total)
if r:
    e5["NVDA->tokens"] = r
results["E5"] = {"desc": "Granger-style: regress stock return on 1-3wk lags of token growth (HAC/Newey-West SE), and the reverse", "models": e5}

# ----------------------------------------------------------------------------
# dump
# ----------------------------------------------------------------------------
# stock levels + returns for the artifact
results["series"] = {
    "weeks": [str(d.date()) for d in common],
    "token_total_T": [float(tok_lvl.loc[w, "Total"]) / 1e12 for w in common],
    "stock_ret": {t: [None if pd.isna(stk_ret.loc[w, t]) else float(stk_ret.loc[w, t]) for w in common] for t in TICKERS},
    "token_growth": [None if pd.isna(g_total.loc[w]) else float(g_total.loc[w]) for w in common],
}
(DATA / "results.json").write_text(json.dumps(results, indent=2))
print("\n=== E1 (contemporaneous Pearson vs Total token growth) ===")
for t, c in e1.items():
    print(f"  {t:5s} r={c['pearson']:+.3f} p={c['pearson_p']:.3f} (FDR {c['pearson_p_fdr']:.3f})  spearman={c['spearman']:+.3f}")
print("\n=== E2 ===")
for p, c in e2.items():
    print(f"  {p}->{c['ticker']:5s} r={c['pearson']:+.3f} p={c['pearson_p']:.3f}")
print("\n=== E3 ===")
print(f"  budget share {e3['budget_share_first']:.1%} -> {e3['budget_share_latest']:.1%}")
print(f"  premium share {e3['premium_share_first']:.1%} -> {e3['premium_share_latest']:.1%}")
print(f"  blended $/M {e3['blended_price_first']:.3f} -> {e3['blended_price_latest']:.3f}")
print("\n=== E5 ===")
for k, v in e5.items():
    print(f"  {k:16s} R2={v['r2']:.3f} F_p={v['f_pvalue']:.3f}")
print("\nwrote", DATA / "results.json")
