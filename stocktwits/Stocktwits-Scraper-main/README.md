# StockTwits Scraper

Python tools to collect messages from StockTwits for stock symbols, built to
gather social-media sentiment data for a basket of semiconductor and related
tickers.

There are **two scrapers**:

1. **API scraper** (`src/stocktwits_api_scraper.py`) — **primary**. Fast and
   reliable. Hits the public StockTwits JSON API
   (`api.stocktwits.com/api/2/streams/symbol/{SYMBOL}.json`, no auth) via `curl`
   and paginates backwards to a target start date. This produced the
   `api_tweets_*.csv` datasets.
2. **Selenium scraper** (`src/stocktwits_selenium_scraper.py`) — **fallback**.
   Drives a headless Chrome browser and scrapes the rendered website. Slower and
   more fragile; use only when the API rate-limits or won't expose enough
   history for a symbol.

## Repo layout

```
stocktwits-scraper/
├── README.md
├── requirements.txt
├── .gitignore
├── src/
│   ├── stocktwits_api_scraper.py        # primary (API) scraper
│   └── stocktwits_selenium_scraper.py   # fallback (browser) scraper
├── scripts/
│   ├── scrape.py                        # scrape one ticker (parameterized)
│   └── update.py                        # append new data to an existing CSV
├── data/
│   └── README.md                        # data dictionary + ticker table (CSVs not committed)
└── docs/
    └── methodology.md                   # scraping + sentiment methodology
```

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

The API scraper needs only `pandas` plus `curl` (installed by default on
macOS/Linux). The Selenium dependencies are only needed for the fallback.

## Usage

### Scrape a ticker (API — recommended)

```bash
python scripts/scrape.py AAPL
python scripts/scrape.py MU --start 2025-09-01 --end 2026-05-06 --max-requests 4000
```

This replaces the old per-ticker scripts (`scrape_aaoi.py`, `scrape_mu.py`,
etc.) — one script, pass the ticker as an argument.

### Append new data

```bash
python scripts/update.py MU --start 2026-03-19 --end 2026-05-06
```

Scrapes only the new window, merges with the existing CSV, drops duplicate
`message_id`s, and writes back newest-first.

### Use the fallback (Selenium) directly

```python
from stocktwits_selenium_scraper import ImprovedStockTwitsScraper
from datetime import date

scraper = ImprovedStockTwitsScraper(headless=True)
msgs = scraper.scrape_symbol_comprehensive('LITE', date(2026, 1, 8), date(2026, 1, 26))
scraper.save_to_csv(msgs, 'lite.csv')
scraper.close()
```

## Data

Scraped CSVs are not committed (see `.gitignore`). See `data/README.md` for the
data dictionary, the list of collected tickers, and how to regenerate them.

## Notes

- **Run one scraper at a time.** Concurrent runs trigger API rate limits.
- High-volume tickers (MU, SNDK) produce tens of thousands of messages and can
  take 45–60 min per scrape.
- When rate-limited the API exposes only a limited history depth per symbol;
  solo scraping retrieves the full history. The Selenium fallback is the
  last resort when the API won't go deep enough.
