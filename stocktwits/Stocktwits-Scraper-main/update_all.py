#!/usr/bin/env python3
"""
Batch + incremental StockTwits collector — the automation entry point.

Reads a list of tickers (tickers.txt by default) and refreshes each one
*sequentially*, scraping only the new window since the latest message already
on disk, then merging and de-duplicating on message_id. Designed to be run
unattended on a schedule (cron / GitHub Actions).

Why sequential: concurrent API requests trigger StockTwits rate-limiting, which
also reduces the history depth the API returns. Always one ticker at a time.

Examples
--------
    python update_all.py
    python update_all.py --tickers tickers.txt --data-dir data
    python update_all.py MU SNDK              # override the file, just these two
"""

import argparse
import sys
import traceback
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd

from stocktwits_api_scraper import StockTwitsAPIScraper

HERE = Path(__file__).resolve().parent
# Canonical CSV schema, matching StockTwitsAPIScraper.save_to_csv, so files
# created here are identical to those from scrape.py.
CANONICAL_COLUMNS = ["symbol", "username", "user_followers", "text", "timestamp",
                     "sentiment", "reshared_count", "link", "message_id", "scraped_at"]
# Full-history start used the first time a ticker is seen (no CSV yet).
DEFAULT_FULL_START = date(2025, 9, 1)
# Re-scrape this many days of overlap so late-arriving posts aren't missed;
# dedupe on message_id removes the overlap.
OVERLAP_DAYS = 2


def parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def read_tickers(path: Path) -> list[str]:
    tickers = []
    for line in path.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            tickers.append(line.upper())
    return tickers


def latest_date_in_csv(path: Path) -> date | None:
    """Newest message date already stored, or None if the file is absent/empty."""
    if not path.exists():
        return None
    try:
        df = pd.read_csv(path)
        if df.empty or "timestamp" not in df.columns:
            return None
        ts = pd.to_datetime(df["timestamp"], errors="coerce", utc=True).dropna()
        return ts.max().date() if not ts.empty else None
    except Exception:
        return None


def refresh_ticker(scraper: StockTwitsAPIScraper, ticker: str, data_dir: Path,
                   end: date, max_requests: int) -> tuple[int, int]:
    """Scrape new data for one ticker and merge into its CSV.

    Returns (rows_added, total_rows).
    """
    path = data_dir / f"api_tweets_{ticker.lower()}.csv"
    last = latest_date_in_csv(path)

    if last is None:
        start = DEFAULT_FULL_START
        print(f"[{ticker}] no existing data — full history from {start}")
    else:
        start = last - timedelta(days=OVERLAP_DAYS)
        print(f"[{ticker}] incremental from {start} (latest on disk: {last})")

    new_messages = scraper.scrape_symbol(ticker, start, end, max_requests=max_requests)
    new_df = pd.DataFrame(new_messages)

    if path.exists():
        existing = pd.read_csv(path)
        if not new_df.empty:
            new_df = new_df.reindex(columns=existing.columns)
        combined = pd.concat([existing, new_df], ignore_index=True)
        before = len(existing)
    else:
        if not new_df.empty:
            new_df = new_df.reindex(columns=CANONICAL_COLUMNS)
        combined = new_df
        before = 0

    if combined.empty:
        print(f"[{ticker}] nothing to write")
        return 0, 0

    combined = (
        combined.drop_duplicates(subset=["message_id"], keep="first")
        .sort_values("timestamp", ascending=False)
    )
    data_dir.mkdir(parents=True, exist_ok=True)
    combined.to_csv(path, index=False, encoding="utf-8")
    added = len(combined) - before
    print(f"[{ticker}] +{added:,} rows, total {len(combined):,} -> {path}")
    return added, len(combined)


def main() -> int:
    parser = argparse.ArgumentParser(description="Batch/incremental StockTwits collector.")
    parser.add_argument("tickers", nargs="*",
                        help="Tickers to refresh (overrides --tickers file)")
    parser.add_argument("--tickers", dest="tickers_file", default=str(HERE / "tickers.txt"),
                        help="File with one ticker per line (default %(default)s)")
    parser.add_argument("--data-dir", default=str(HERE / "data"),
                        help="Directory for api_tweets_<ticker>.csv (default %(default)s)")
    parser.add_argument("--end", type=parse_date, default=date.today(),
                        help="End date YYYY-MM-DD (default today)")
    parser.add_argument("--max-requests", type=int, default=4000,
                        help="Per-ticker request cap (default %(default)s)")
    args = parser.parse_args()

    tickers = [t.upper() for t in args.tickers] or read_tickers(Path(args.tickers_file))
    if not tickers:
        print("No tickers to process.", file=sys.stderr)
        return 1

    data_dir = Path(args.data_dir)
    scraper = StockTwitsAPIScraper()

    print(f"Refreshing {len(tickers)} tickers up to {args.end}: {', '.join(tickers)}")
    results, failures = {}, []
    for ticker in tickers:
        try:
            added, total = refresh_ticker(scraper, ticker, data_dir, args.end, args.max_requests)
            results[ticker] = (added, total)
        except Exception as exc:  # one bad ticker must not abort the batch
            failures.append(ticker)
            print(f"[{ticker}] FAILED: {exc}")
            traceback.print_exc()

    print("\n" + "=" * 60)
    print("Summary")
    for ticker, (added, total) in results.items():
        print(f"  {ticker}: +{added:,} (total {total:,})")
    if failures:
        print(f"  FAILED: {', '.join(failures)}")
    print("=" * 60)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
