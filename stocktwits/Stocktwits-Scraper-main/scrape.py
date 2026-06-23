#!/usr/bin/env python3
"""
Scrape one ticker from StockTwits.

Replaces the ~25 individual scrape_<ticker>.py files with a single
parameterized script. Pass the ticker (and optional dates) on the command line.

Examples
--------
    python scripts/scrape.py AAPL
    python scripts/scrape.py MU --start 2025-09-01 --end 2026-05-06 --max-requests 4000
    python scripts/scrape.py AEHR --out data/api_tweets_aehr.csv
"""

import argparse
import sys
from datetime import date, datetime
from pathlib import Path

# Make src/ importable regardless of where the script is run from.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from stocktwits_api_scraper import StockTwitsAPIScraper  # noqa: E402

DEFAULT_START = date(2025, 9, 1)
DEFAULT_END = date(2026, 5, 6)


def parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape one ticker from StockTwits.")
    parser.add_argument("ticker", help="Stock ticker symbol, e.g. AAPL")
    parser.add_argument("--start", type=parse_date, default=DEFAULT_START,
                        help="Start date YYYY-MM-DD (default %(default)s)")
    parser.add_argument("--end", type=parse_date, default=DEFAULT_END,
                        help="End date YYYY-MM-DD (default %(default)s)")
    parser.add_argument("--max-requests", type=int, default=2000,
                        help="Cap on API requests (default %(default)s)")
    parser.add_argument("--out", default=None,
                        help="Output CSV path (default data/api_tweets_<ticker>.csv)")
    args = parser.parse_args()

    ticker = args.ticker.upper()
    out = args.out or f"data/api_tweets_{ticker.lower()}.csv"
    Path(out).parent.mkdir(parents=True, exist_ok=True)

    print(f"Scraping {ticker} from {args.start} to {args.end} "
          f"(max {args.max_requests} requests)...")
    scraper = StockTwitsAPIScraper()
    messages = scraper.scrape_symbol(ticker, args.start, args.end, max_requests=args.max_requests)
    scraper.save_to_csv(messages, out)
    print(f"Saved {len(messages):,} messages to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
