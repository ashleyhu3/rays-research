"""
AI-demand  x  equity-return study  v2  (full-history, composite index, pure-plays).

Fixes vs the nulled pilot (analysis.py, n=25 SVG reconstruction):
  * Full 81-week OpenRouter series + daily rows (analysis/data/or_*.json).
  * Demand = *innovations* (AR(1)+trend residuals), launch-adjusted "organic"
    token growth, acceleration — not raw persistent trend.
  * A composite AI-Compute-Demand-Index (ACDI) across orthogonal channels
    (tokens, DRAM spot, NAND spot, GPU rental, AWS tightness, sentiment breadth)
    so one noisy channel can't swamp the signal.
  * Pure-play outcomes (memory / optics baskets) where AI demand IS the revenue
    line, plus relative-to-QQQ and forward returns; quantile framing; Newey-West;
    BH-FDR on a pre-registered primary set; split-half stability.

Outputs: data/results2.json, data/series2.json, data/prices_daily.csv (cached).
"""
import json, warnings, datetime as dt
from pathlib import Path
import numpy as np, pandas as pd
from scipy import stats
import statsmodels.api as sm

warnings.filterwarnings("ignore")
HERE = Path(__file__).parent; DATA = HERE / "data"; MG = DATA / "mongo"
np.random.seed(0)
J = lambda f: json.loads((f).read_text())

# ─────────────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────────────
def zscore(s):
    s = pd.Series(s, dtype=float); return (s - s.mean()) / s.std(ddof=0)

def ar1_trend_innovation(loglevel):
    """Residual of  y_t = a + b*t + c*y_{t-1} + e_t  (y = log level). e_t = surprise."""
    y = pd.Series(loglevel, dtype=float).dropna()
    if len(y) < 8: return pd.Series(dtype=float)
    df = pd.DataFrame({"y": y, "t": np.arange(len(y)), "yl": y.shift(1)}).dropna()
    X = sm.add_constant(df[["t", "yl"]]); m = sm.OLS(df["y"], X).fit()
    return pd.Series(m.resid.values, index=df.index)

def chained_index(price_by_date, sku_filter=None):
    """Robust chained price index from an irregular {date:{sku:price}} dict.
    Each step = median cross-SKU log-change over SKUs present in both prints."""
    dates = sorted(price_by_date.keys())
    lvl, chg, keep = [1.0], [np.nan], [dates[0]]
    for i in range(1, len(dates)):
        prev, cur = price_by_date[dates[i-1]], price_by_date[dates[i]]
        common = [k for k in cur if k in prev and prev[k] and cur[k] and prev[k] > 0 and cur[k] > 0
                  and (sku_filter is None or sku_filter(k))]
        if not common:
            lvl.append(lvl[-1]); chg.append(0.0); keep.append(dates[i]); continue
        d = float(np.median([np.log(cur[k] / prev[k]) for k in common]))
        lvl.append(lvl[-1] * np.exp(d)); chg.append(d); keep.append(dates[i])
    idx = pd.to_datetime(keep)
    return pd.Series(lvl, index=idx), pd.Series(chg, index=idx)

def corr_block(x, y, min_n=8):
    d = pd.concat([pd.Series(x), pd.Series(y)], axis=1).dropna()
    if len(d) < min_n: return None
    a, b = d.iloc[:, 0].values, d.iloc[:, 1].values
    pr, pp = stats.pearsonr(a, b); sr, sp = stats.spearmanr(a, b)
    # Newey-West HAC p on slope of b ~ a
    X = sm.add_constant(a); mdl = sm.OLS(b, X).fit(cov_type="HAC", cov_kwds={"maxlags": 3})
    return {"n": int(len(d)), "pearson": float(pr), "pearson_p": float(pp),
            "spearman": float(sr), "spearman_p": float(sp),
            "beta": float(mdl.params[1]), "hac_p": float(mdl.pvalues[1]),
            "x": [float(v) for v in a], "y": [float(v) for v in b]}

def bh_fdr(pvals):
    p = np.asarray(pvals, float); m = len(p); order = np.argsort(p); adj = np.empty(m); prev = 1.0
    for rank, idx in enumerate(order[::-1]):
        i = m - rank; adj[idx] = min(prev, p[idx] * m / i); prev = adj[idx]
    return adj

def quantile_test(demand, fwd_ret, q=3):
    """Compare forward return after top-tertile vs bottom-tertile demand weeks."""
    d = pd.concat([pd.Series(demand, name="d"), pd.Series(fwd_ret, name="r")], axis=1).dropna()
    if len(d) < 12: return None
    try: d["b"] = pd.qcut(d["d"], q, labels=False, duplicates="drop")
    except Exception: return None
    hi, lo = d[d.b == d.b.max()]["r"], d[d.b == d.b.min()]["r"]
    if len(hi) < 3 or len(lo) < 3: return None
    t, p = stats.ttest_ind(hi, lo, equal_var=False)
    return {"n": int(len(d)), "top_mean": float(hi.mean()), "bot_mean": float(lo.mean()),
            "spread": float(hi.mean() - lo.mean()), "t": float(t), "p": float(p),
            "top_n": int(len(hi)), "bot_n": int(len(lo))}

# ─────────────────────────────────────────────────────────────────────────────
# 1. OpenRouter demand channels (weekly, ISO Monday)
# ─────────────────────────────────────────────────────────────────────────────
prov = pd.read_csv(DATA / "or_weekly_provider.csv", parse_dates=["monday"]).set_index("monday")
prov_full = prov[prov["ndays"] == 7].copy()            # drop partial first/last weeks
tok_total = prov_full["Total"].astype(float)
tok_weeks = tok_total.index
print(f"OpenRouter full weeks: {tok_weeks[0].date()}..{tok_weeks[-1].date()} (n={len(tok_total)})")

models = J(DATA / "or_weekly_models.json")
mweeks = pd.to_datetime(models["weeks"]); ndays = pd.Series(models["ndays"], index=mweeks)
# launch-adjusted "organic" total: only models with age >= 28d at that week's Monday
first_seen = {s: pd.Timestamp(models["firstSeen"][s]) for s in models["series"]}
organic = pd.Series(0.0, index=mweeks)
for s, series in models["series"].items():
    fs = first_seen[s]; ser = pd.Series(series, index=mweeks, dtype=float)
    ser[mweeks < fs + pd.Timedelta(days=28)] = 0.0        # exclude first ~4 weeks post-launch
    organic += ser
organic = organic[ndays == 7]

g_total   = np.log(tok_total).diff()                                  # raw WoW growth
g_organic = np.log(organic.replace(0, np.nan)).diff().reindex(tok_weeks)
accel     = g_total.diff()                                            # acceleration Δ²log
innov_tok = ar1_trend_innovation(np.log(tok_total)).reindex(tok_weeks)

# per-provider weekly (for per-company demand); share-neutral log growth
PROVS = ["Anthropic", "Google", "OpenAI", "DeepSeek", "xAI", "MiniMax", "Moonshot", "Qwen", "Zhipu"]
prov_growth = {p: np.log(prov_full[p].replace(0, np.nan).astype(float)).diff() for p in PROVS if p in prov_full}

# ─────────────────────────────────────────────────────────────────────────────
# 2. Physical-compute channels (DRAM / NAND / GPU rental / AWS tightness)
# ─────────────────────────────────────────────────────────────────────────────
dram = J(MG / "dramHistory.json"); nand = J(MG / "nandHistory.json")
gpu  = J(MG / "gpuHistory.json");  aws  = J(MG / "awsHistory.json")

dram_lvl, dram_chg = chained_index(dram, sku_filter=lambda k: k.startswith("DDR"))       # DDR complex
nand_lvl, nand_chg = chained_index(nand)
# GPU rental: blended datacenter accelerators only (H100/H200/B200/A100), od+spot mean
def gpu_price(v):
    out = {}
    for acc, d in v.items():
        if not isinstance(d, dict): continue
        if not any(acc.startswith(p) for p in ("H100", "H200", "B200", "A100")): continue
        px = [x for x in (d.get("od"), d.get("spot")) if isinstance(x, (int, float)) and x > 0]
        if px: out[acc] = float(np.mean(px))
    return out
gpu_clean = {dte: gpu_price(v) for dte, v in gpu.items() if gpu_price(v)}
gpu_lvl, gpu_chg = chained_index(gpu_clean)
# AWS tightness: mean spot discount (savings%) across accelerators; LOWER savings = TIGHTER.
# tightness_t = -Δ(mean savings). Positive tightness = demand pressure.
aws_sav = {}
for dte, v in aws.items():
    if not dte.startswith("2") or not isinstance(v, dict): continue
    sv = [d["savings"] for d in v.values() if isinstance(d, dict) and isinstance(d.get("savings"), (int, float))]
    if sv: aws_sav[dte] = float(np.mean(sv))
aws_sav = pd.Series(aws_sav); aws_sav.index = pd.to_datetime(aws_sav.index); aws_sav = aws_sav.sort_index()
aws_tight = -aws_sav.diff()

print(f"DRAM prints: {dram_lvl.index[0].date()}..{dram_lvl.index[-1].date()} (n={len(dram_lvl)}); "
      f"NAND n={len(nand_lvl)}; GPU n={len(gpu_lvl)}; AWS days={len(aws_sav)}")

# ─────────────────────────────────────────────────────────────────────────────
# 3. Sentiment breadth (StockTwits daily, 18 AI-hardware tickers)
# ─────────────────────────────────────────────────────────────────────────────
st = pd.DataFrame(J(MG / "stocktwits_daily.json"))
st["date"] = pd.to_datetime(st["date"])
st["net"] = (st["bull"] - st["bear"]) / (st["bull"] + st["bear"]).replace(0, np.nan)
CATS = {"Memory Semiconductors": ["SNDK", "MU", "WDC", "STX"],
        "Optics": ["AAOI", "CIEN", "LITE", "COHR", "GLW", "APH"]}
def breadth(symbols):
    sub = st[st["symbol"].isin(symbols)]
    daily = sub.groupby("date")["net"].mean()
    return daily.resample("W-MON", label="left", closed="left").mean()
sent_all = breadth(st["symbol"].unique())
sent_mem = breadth(CATS["Memory Semiconductors"])

# ─────────────────────────────────────────────────────────────────────────────
# 4. Stocks (daily closes, cached) → weekly + interval returns
# ─────────────────────────────────────────────────────────────────────────────
MEM = ["MU", "SNDK", "WDC", "STX"]; COMPUTE = ["NVDA", "AVGO", "TSM", "AMD", "MRVL"]
OPTICS = ["COHR", "LITE", "AAOI", "CIEN", "GLW"]; POWER = ["VRT"]
MEGA = ["MSFT", "GOOGL", "META", "AMZN"]; BENCH = ["QQQ", "SMH", "SOXX"]
ALL = MEM + COMPUTE + OPTICS + POWER + MEGA + BENCH
pxfile = DATA / "prices_daily.csv"
if pxfile.exists():
    px = pd.read_csv(pxfile, parse_dates=["Date"]).set_index("Date")
else:
    import yfinance as yf
    px = yf.download(ALL, start="2024-12-01", end="2026-07-16", interval="1d",
                     auto_adjust=True, progress=False)["Close"]
    px.index = pd.to_datetime(px.index).normalize(); px.to_csv(pxfile)
pxb = px.reindex(pd.date_range(px.index.min(), px.index.max(), freq="D")).ffill()   # daily ffill grid
wk = px.resample("W-MON", label="left", closed="left").last()
wret = np.log(wk).diff()                                        # weekly log returns
def basket_ret(names): return wret[[n for n in names if n in wret]].mean(axis=1)
r_mem, r_comp, r_opt = basket_ret(MEM), basket_ret(COMPUTE), basket_ret(OPTICS)
r_ai = basket_ret(MEM + COMPUTE + OPTICS + POWER)
r_qqq = wret["QQQ"]
rel = lambda r: r - r_qqq                                        # market-neutralised

def interval_ret(name, d0, d1):
    """log return of `name` between two arbitrary dates using daily ffill grid."""
    try:
        p0 = pxb.loc[:d0, name].iloc[-1]; p1 = pxb.loc[:d1, name].iloc[-1]
        if p0 > 0 and p1 > 0: return float(np.log(p1 / p0))
    except Exception: pass
    return np.nan
def basket_interval(names, d0, d1):
    vals = [interval_ret(n, d0, d1) for n in names]; vals = [v for v in vals if v == v]
    return float(np.mean(vals)) if vals else np.nan

# ─────────────────────────────────────────────────────────────────────────────
# 5. Composite ACDI  (weekly average of available standardized innovations)
# ─────────────────────────────────────────────────────────────────────────────
def to_weekly(series_by_date):
    s = pd.Series(series_by_date).copy(); s.index = pd.to_datetime(s.index)
    return s.groupby(s.index.to_period("W-MON").start_time).mean()

chan = {
    "tokens":   zscore(innov_tok),
    "dram":     zscore(to_weekly(dram_chg)),
    "nand":     zscore(to_weekly(nand_chg)),
    "gpu":      zscore(to_weekly(gpu_chg)),
    "aws":      zscore(to_weekly(aws_tight)),
    "sentiment":zscore(sent_all.diff()),
}
grid = pd.date_range("2025-01-06", tok_weeks[-1], freq="W-MON")
cf = pd.DataFrame({k: v.reindex(grid) for k, v in chan.items()})
acdi = cf.mean(axis=1, skipna=True)                    # equal-weight composite
acdi_n = cf.notna().sum(axis=1)
acdi = acdi.where(acdi_n >= 2)                          # require >=2 channels
# memory-specific sub-index
memf = pd.DataFrame({"dram": zscore(to_weekly(dram_chg)).reindex(grid),
                     "nand": zscore(to_weekly(nand_chg)).reindex(grid),
                     "sent_mem": zscore(sent_mem.diff()).reindex(grid),
                     "tokens": zscore(innov_tok).reindex(grid)})
acdi_mem = memf.mean(axis=1, skipna=True).where(memf.notna().sum(axis=1) >= 2)

# ─────────────────────────────────────────────────────────────────────────────
# 6. TESTS
# ─────────────────────────────────────────────────────────────────────────────
R = {"meta": {"generated": dt.datetime.now().isoformat(timespec="seconds"),
              "token_weeks": [str(tok_weeks[0].date()), str(tok_weeks[-1].date())],
              "n_token_weeks": int(len(tok_total))}}

# --- PRIMARY pre-registered set -------------------------------------------------
primary = {}

# P1: DRAM spot innovation vs memory basket, matched to DRAM print intervals (contemp + fwd)
dd = dram_chg.index
rows = []
for i in range(1, len(dd)):
    d0, d1 = dd[i-1], dd[i]
    rows.append({"date": d1, "dram": dram_chg.iloc[i], "ndays": (d1 - d0).days,
                 "mem_same": basket_interval(MEM, d0, d1),
                 "mem_fwd": basket_interval(MEM, d1, d1 + pd.Timedelta(days=14))})
dq = pd.DataFrame(rows).set_index("date")
primary["P1_dram_mem_contemp"] = {"desc": "DRAM spot Δ vs memory-basket return over the same DRAM-print interval",
                                   **(corr_block(dq["dram"], dq["mem_same"]) or {})}
primary["P1b_dram_mem_fwd2w"] = {"desc": "DRAM spot Δ vs memory-basket return over the NEXT 14 days",
                                  **(corr_block(dq["dram"], dq["mem_fwd"]) or {})}

# P1 ROBUSTNESS — rule out the irregular-interval length confound (long gaps inflate both sides)
dqc = dq.dropna(subset=["dram", "mem_same"]).copy()
# (a) per-day rates: divide both sides by interval length, then correlate
pd_dram = dqc["dram"] / dqc["ndays"]; pd_mem = dqc["mem_same"] / dqc["ndays"]
# (b) partial: OLS mem ~ dram + ndays, is the dram slope still significant?
Xp = sm.add_constant(dqc[["dram", "ndays"]])
mp = sm.OLS(dqc["mem_same"], Xp).fit(cov_type="HAC", cov_kwds={"maxlags": 3})
# (c) fixed-cadence monthly: month-end DRAM index Δ vs month-end memory-basket Δ (removes irregular spacing)
dram_m = dram_lvl.resample("ME").last(); mem_px_m = np.exp(np.log(wk[MEM]).mean(axis=1)).resample("ME").last()
dram_m_chg = np.log(dram_m).diff(); mem_m_ret = np.log(mem_px_m).diff()
primary["P1_robustness"] = {
    "per_day_rate": corr_block(pd_dram, pd_mem, min_n=8),
    "partial_control_ndays": {"beta_dram": float(mp.params["dram"]), "hac_p_dram": float(mp.pvalues["dram"]),
                              "beta_ndays": float(mp.params["ndays"]), "hac_p_ndays": float(mp.pvalues["ndays"]),
                              "n": int(len(dqc))},
    "monthly_fixed_cadence": corr_block(dram_m_chg, mem_m_ret, min_n=8),
}

# P2: NAND spot innovation vs memory basket (native NAND intervals)
nn = nand_chg.index; nrows = []
for i in range(1, len(nn)):
    d0, d1 = nn[i-1], nn[i]
    nrows.append({"date": d1, "nand": nand_chg.iloc[i], "mem_same": basket_interval(MEM, d0, d1)})
nqd = pd.DataFrame(nrows).set_index("date")
primary["P2_nand_mem_contemp"] = {"desc": "NAND spot Δ vs memory-basket return over the same NAND-print interval",
                                   **(corr_block(nqd["nand"], nqd["mem_same"]) or {})}

# P3: weekly composite ACDI vs AI-complex minus QQQ (contemp + forward 1-2w)
primary["P3_acdi_ai_rel"] = {"desc": "Weekly ACDI vs AI-complex basket return (rel. QQQ), contemporaneous",
                             **(corr_block(acdi, rel(r_ai)) or {})}
primary["P3b_acdi_ai_rel_fwd1w"] = {"desc": "Weekly ACDI vs AI-complex rel-QQQ return, 1 week forward",
                                    **(corr_block(acdi, rel(r_ai).shift(-1)) or {})}

# P4: memory ACDI vs memory-basket relative return (contemp + fwd1w)
primary["P4_acdimem_mem_rel"] = {"desc": "Memory ACDI vs memory-basket return (rel. QQQ), contemporaneous",
                                 **(corr_block(acdi_mem, rel(r_mem)) or {})}
primary["P4b_acdimem_mem_rel_fwd1w"] = {"desc": "Memory ACDI vs memory-basket rel-QQQ return, 1 week forward",
                                        **(corr_block(acdi_mem, rel(r_mem).shift(-1)) or {})}

# P3 DECOMPOSITION: is the ACDI<->AI-complex link fundamental demand, or reflexive sentiment?
fund_cols = ["tokens", "dram", "nand", "gpu", "aws"]
acdi_fund = cf[fund_cols].mean(axis=1, skipna=True).where(cf[fund_cols].notna().sum(axis=1) >= 1)
primary["P3_decomp"] = {
    "acdi_full_vs_ai_rel":  corr_block(acdi, rel(r_ai)),
    "acdi_fundamental_vs_ai_rel": corr_block(acdi_fund, rel(r_ai)),   # tokens+physical, NO sentiment
    "sentiment_only_vs_ai_rel": corr_block(zscore(sent_all.diff()), rel(r_ai)),
    "per_channel_vs_ai_rel": {k: (corr_block(v, rel(r_ai)) or {}) for k, v in chan.items()},
    "per_channel_vs_ai_abs": {k: (corr_block(v, r_ai) or {}) for k, v in chan.items()},
}

# P5: token demand innovation vs compute basket, forward 1-2 weeks
primary["P5_tokens_compute_fwd1w"] = {"desc": "OpenRouter token innovation vs compute-basket return, 1 week forward",
                                      **(corr_block(innov_tok, r_comp.shift(-1)) or {})}
primary["P5b_tokens_compute_fwd2w"] = {"desc": "OpenRouter token innovation vs compute-basket return, 2 weeks forward",
                                       **(corr_block(innov_tok, r_comp.shift(-2)) or {})}

# BH-FDR across the primary set (use HAC p where available, else pearson_p)
keys = [k for k in primary if "n" in primary[k]]
praw = [primary[k].get("hac_p", primary[k]["pearson_p"]) for k in keys]
for k, a in zip(keys, bh_fdr(praw)): primary[k]["fdr_p"] = float(a)
R["primary"] = primary

# --- EXPLORATORY ----------------------------------------------------------------
expl = {}
# per-company: each channel vs each stock's weekly return (rel QQQ), contemporaneous
grid_map = {"tokens_innov": innov_tok, "organic_growth": g_organic, "accel": accel,
            "acdi": acdi, "acdi_mem": acdi_mem, "sent_all_chg": sent_all.diff()}
mat = {}
for dn, dser in grid_map.items():
    mat[dn] = {}
    for t in MEM + COMPUTE + OPTICS + POWER + MEGA:
        if t not in wret: continue
        c = corr_block(dser, rel(wret[t]), min_n=10)
        if c: mat[dn][t] = {"r": c["pearson"], "p": c["pearson_p"], "n": c["n"]}
expl["channel_x_stock_relQQQ"] = mat

# quantile framing: ACDI terciles -> forward 1w AI basket rel return
expl["quantile_acdi_ai_fwd1w"] = quantile_test(acdi, rel(r_ai).shift(-1))
expl["quantile_dram_mem"] = quantile_test(dq["dram"], dq["mem_same"])

# split-half stability of token-innovation vs compute (fwd1w)
def split_half(x, y):
    d = pd.concat([pd.Series(x), pd.Series(y)], axis=1).dropna(); h = len(d) // 2
    if h < 8: return None
    a = stats.pearsonr(d.iloc[:h, 0], d.iloc[:h, 1]); b = stats.pearsonr(d.iloc[h:, 0], d.iloc[h:, 1])
    return {"first_r": float(a[0]), "first_n": int(h), "second_r": float(b[0]), "second_n": int(len(d) - h)}
expl["split_half_tokens_compute_fwd1w"] = split_half(innov_tok, r_comp.shift(-1))
expl["split_half_dram_mem"] = split_half(dq["dram"], dq["mem_same"])
# HORIZON SWEEP — give the fundamental hypothesis every fair shot: each demand
# channel (fixed weekly cadence) vs each basket return at h = 0,1,2,4 weeks fwd.
sweep_demand = {
    "tokens_innov": innov_tok, "organic_growth": g_organic, "accel": accel,
    "dram_w": to_weekly(dram_chg), "nand_w": to_weekly(nand_chg),
    "gpu_w": to_weekly(gpu_chg), "aws_tight_w": to_weekly(aws_tight),
    "sent_all_chg": sent_all.diff(), "sent_mem_chg": sent_mem.diff(),
    "acdi": acdi, "acdi_fundamental": acdi_fund,
}
sweep_out = {"AI": r_ai, "AI_relQQQ": rel(r_ai), "memory": r_mem, "memory_relQQQ": rel(r_mem),
             "compute": r_comp, "compute_relQQQ": rel(r_comp), "optics": r_opt}
sweep = []
for dn, ds in sweep_demand.items():
    for on, os_ in sweep_out.items():
        for h in (0, 1, 2, 4):
            c = corr_block(ds, os_.shift(-h), min_n=12)
            if c: sweep.append({"demand": dn, "outcome": on, "h": h, "r": c["pearson"],
                                "p": c["pearson_p"], "n": c["n"], "fundamental": "sent" not in dn and dn != "acdi"})
if sweep:
    for row, a in zip(sweep, bh_fdr([r["p"] for r in sweep])): row["fdr_p"] = float(a)
expl["horizon_sweep"] = sweep
R["exploratory"] = expl

(DATA / "results2.json").write_text(json.dumps(R, indent=2, default=str))

# ─────────────────────────────────────────────────────────────────────────────
# 7. Series for charts
# ─────────────────────────────────────────────────────────────────────────────
def ser(s): s = pd.Series(s).dropna(); return {str(pd.Timestamp(k).date()): float(v) for k, v in s.items()}
S = {
    "token_total_T": {str(k.date()): float(v/1e12) for k, v in tok_total.items()},
    "token_growth": ser(g_total), "token_innov": ser(innov_tok), "organic_growth": ser(g_organic),
    "dram_index": ser(dram_lvl), "nand_index": ser(nand_lvl), "gpu_index": ser(gpu_lvl),
    "aws_savings": ser(aws_sav), "sent_all": ser(sent_all), "sent_mem": ser(sent_mem),
    "acdi": ser(acdi), "acdi_mem": ser(acdi_mem),
    "r_mem": ser(r_mem), "r_comp": ser(r_comp), "r_ai": ser(r_ai), "r_qqq": ser(r_qqq),
    "px_mem_basket": ser(np.exp(np.log(wk[MEM]).mean(axis=1))),
    "channel_loadings": {k: ser(v) for k, v in chan.items()},
    "scatter_dram_mem": {"x": dq["dram"].dropna().tolist(),
                         "y": dq.loc[dq["dram"].dropna().index, "mem_same"].tolist()},
}
(DATA / "series2.json").write_text(json.dumps(S, default=str))

# ─────────────────────────────────────────────────────────────────────────────
# console summary
# ─────────────────────────────────────────────────────────────────────────────
print("\n=== PRIMARY (pre-registered) ===")
for k, v in primary.items():
    if "pearson" not in v: print(f"  {k}: n/a"); continue
    print(f"  {k:30s} n={v['n']:3d}  r={v['pearson']:+.3f}  p={v['pearson_p']:.3f}  "
          f"HACp={v.get('hac_p',float('nan')):.3f}  FDR={v.get('fdr_p',float('nan')):.3f}  ρ={v['spearman']:+.3f}")
dc = primary["P3_decomp"]
print("\n=== P3 decomposition: what drives ACDI <-> AI complex? ===")
def _pr(x): return f"r={x['pearson']:+.3f} p={x['pearson_p']:.3f} n={x['n']}" if x else "n/a (too sparse)"
print(f"  ACDI full        vs AI-rel: {_pr(dc['acdi_full_vs_ai_rel'])}")
print(f"  ACDI fundamental vs AI-rel: {_pr(dc['acdi_fundamental_vs_ai_rel'])}  (tokens+physical, NO sentiment)")
print(f"  sentiment only   vs AI-rel: {_pr(dc['sentiment_only_vs_ai_rel'])}")
print("  per-channel vs AI-rel:")
for k, v in dc["per_channel_vs_ai_rel"].items():
    if v: print(f"    {k:10s} r={v['pearson']:+.3f} p={v['pearson_p']:.3f} n={v['n']}")
rb = R["primary"]["P1_robustness"]
print("\n=== P1 robustness (length-confound controls) ===")
print(f"  per-day-rate corr: r={rb['per_day_rate']['pearson']:+.3f} p={rb['per_day_rate']['pearson_p']:.3f} n={rb['per_day_rate']['n']}")
print(f"  partial (ctrl ndays): dram beta HACp={rb['partial_control_ndays']['hac_p_dram']:.3f}  ndays HACp={rb['partial_control_ndays']['hac_p_ndays']:.3f}")
print(f"  monthly fixed-cadence: r={rb['monthly_fixed_cadence']['pearson']:+.3f} p={rb['monthly_fixed_cadence']['pearson_p']:.3f} n={rb['monthly_fixed_cadence']['n']}")
print("\n=== quantile / split-half ===")
print("  ACDI->AI fwd1w:", expl["quantile_acdi_ai_fwd1w"])
print("  DRAM->MEM tercile:", expl["quantile_dram_mem"])
print("  split-half tokens->compute:", expl["split_half_tokens_compute_fwd1w"])
print("  split-half dram->mem:", expl["split_half_dram_mem"])
print("\n=== best channel x stock (|r|, contemp rel-QQQ) ===")
flat = []
for dn, d in mat.items():
    for t, c in d.items(): flat.append((abs(c["r"]), dn, t, c["r"], c["p"], c["n"]))
for a, dn, t, r, p, n in sorted(flat, reverse=True)[:12]:
    print(f"  {dn:16s} {t:5s} r={r:+.3f} p={p:.3f} n={n}")
print("\n=== horizon sweep: strongest |r| among FUNDAMENTAL channels (no sentiment/acdi) ===")
fund = [s for s in sweep if s["fundamental"]]
for s in sorted(fund, key=lambda x: -abs(x["r"]))[:12]:
    print(f"  {s['demand']:16s} -> {s['outcome']:16s} h={s['h']}  r={s['r']:+.3f} p={s['p']:.3f} FDR={s['fdr_p']:.2f} n={s['n']}")
nfund_sig = sum(1 for s in fund if s["fdr_p"] < 0.10)
print(f"  fundamental cells surviving FDR<0.10: {nfund_sig} / {len(fund)}")
print("\n=== horizon sweep: strongest overall (incl. sentiment/acdi) ===")
for s in sorted(sweep, key=lambda x: -abs(x["r"]))[:8]:
    tag = "" if s["fundamental"] else "  [reflexive]"
    print(f"  {s['demand']:16s} -> {s['outcome']:16s} h={s['h']}  r={s['r']:+.3f} p={s['p']:.3f} FDR={s['fdr_p']:.2f} n={s['n']}{tag}")
# PROMISING THREAD: does launch-adjusted organic token growth LEAD the compute basket?
thread = {"horizon_profile": {}, "split_half_h4": None}
for h in range(-2, 8):
    c = corr_block(g_organic, r_comp.shift(-h), min_n=12)
    if c: thread["horizon_profile"][h] = {"r": c["pearson"], "p": c["pearson_p"], "n": c["n"]}
thread["split_half_h4"] = split_half(g_organic, r_comp.shift(-4))
# accel -> compute_relQQQ profile too
thread["accel_profile"] = {h: (corr_block(accel, rel(r_comp).shift(-h), min_n=12) or {}).get("pearson")
                           for h in range(-2, 8)}
R["exploratory"]["promising_thread_organic_leads_compute"] = thread
(DATA / "results2.json").write_text(json.dumps(R, indent=2, default=str))
print("\n=== PROMISING THREAD: organic token growth -> compute basket, lead profile ===")
for h, v in thread["horizon_profile"].items():
    star = " *" if v["p"] < 0.05 else ""
    print(f"  h={h:+d}w  r={v['r']:+.3f} p={v['p']:.3f} n={v['n']}{star}")
print("  split-half @h=4:", thread["split_half_h4"])
print("\nwrote results2.json, series2.json")
