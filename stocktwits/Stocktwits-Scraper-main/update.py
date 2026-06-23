#!/usr/bin/env python3
"""
Append new StockTwits messages to an existing CSV.

Scrapes from a new start date, merges with the existing file, drops duplicate
message_ids, and writes back sorted newest-first. Use this to refresh a ticker
without re-scraping its full history (e.g. the pending MU / SNDK updates).

Examples
--------
    python scripts/update.py MU --start 2026-03-19 --end 2026-05-06
    python scripts/update.py SNDK --start 2026-03-19 --end 2026-05-06 --max-requests 4000
"""

import argparse
import sys
from datetime import date, datetime
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from stocktwits_api_scraper import StockTwitsAPIScraper  # noqa: E402


def parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def main() -> int:
    parser = argparse.ArgumentParser(description="Append new StockTwits data to an existing CSV.")
    parser.add_argument("ticker", help="Stock ticker symbol, e.g. MU")
    parser.add_argument("--start", type=parse_date, required=True,
                        help="Start date YYYY-MM-DD for the new data")
    parser.add_argument("--end", type=parse_date, required=True,
                        help="End date YYYY-MM-DD for the new data")
    parser.add_argument("--max-requests", type=int, default=2000)
    parser.add_argument("--file", default=None,
                        help="Existing CSV path (default data/api_tweets_<ticker>.csv)")
    args = parser.parse_args()

    ticker = args.ticker.upper()
    path = args.file or f"data/api_tweets_{ticker.lower()}.csv"

    if not Path(path).exists():
        print(f"ERROR: {path} does not exist. Run scrape.py first for a full history.")
        return 1

    print(f"Scraping new {ticker} data {args.start} to {args.end}...")
    scraper = StockTwitsAPIScraper()
    new_messages = scraper.scrape_symbol(ticker, args.start, args.end, max_requests=args.max_requests)

    existing = pd.read_csv(path)
    new_df = pd.DataFrame(new_messages)
    # Align to the existing column order before concatenating.
    new_df = new_df[list(existing.columns)]

    combined = (
        pd.concat([existing, new_df])
        .drop_duplicates(subset=["message_id"])
        .sort_values("timestamp", ascending=False)
    )
    combined.to_csv(path, index=False)
    added = len(combined) - len(existing)
    print(f"Added {added:,} new rows. Total now {len(combined):,}. Saved to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
