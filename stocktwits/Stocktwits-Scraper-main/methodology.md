# Methodology

This document describes how the StockTwits sentiment dataset was collected and
processed, for anyone picking up the project.

## 1. Goal

Collect social-media sentiment (StockTwits messages) for a basket of
semiconductor and related tickers, to support downstream analysis and the
accompanying presentation.

## 2. Data source

Two collection methods were built; the API method is primary.

**Primary — StockTwits JSON API** (`src/stocktwits_api_scraper.py`)
- **Endpoint:** `api.stocktwits.com/api/2/streams/symbol/{SYMBOL}.json`
- **Auth:** none required.
- **Transport:** requests are made with `curl` (via `subprocess`) to avoid
  blocking.
- **Pagination:** the API returns messages newest-first in pages; we page
  backwards using the `max` cursor (max_id) until we reach the target start date
  or hit `max_requests`.

**Fallback — Selenium browser scraper** (`src/stocktwits_selenium_scraper.py`)
- Drives a headless Chrome browser, scrolls the StockTwits website, and parses
  the rendered HTML with BeautifulSoup.
- Used only when the API rate-limits or won't expose enough history for a
  symbol (e.g. some of the early LITE/COHR January pulls). Slower and more
  fragile than the API method.

## 3. Collection process

1. For each ticker, call `scripts/scrape.py <TICKER> --start <DATE> --end <DATE>`.
2. The scraper walks back page by page, parsing each message into a flat row.
3. Results are written to `data/api_tweets_<ticker>.csv`.
4. Refreshes use `scripts/update.py`, which scrapes only the new window and
   de-duplicates on `message_id`.

### Fields captured

See the data dictionary in `data/README.md`.

## 4. Sentiment

Sentiment is taken directly from the StockTwits message metadata. In the API
scraper it reads `entities.sentiment.basic` and title-cases it to **Bullish**
or **Bearish**; messages with no tag are recorded as **Neutral**. The Selenium
fallback reads the on-page sentiment label, falling back to a keyword check of
the message text.

These labels are user-supplied (the poster self-tags the message), not derived
from the text by a classifier.

## 5. Known limitations / gotchas

- **Rate limits:** running multiple scrapers concurrently triggers throttling,
  which also reduces the history depth the API will return. Always run one
  ticker at a time.
- **Throughput:** high-volume tickers (MU, SNDK) take 45–60 minutes each.
- **Self-reported sentiment:** the Bullish/Bearish label is user-supplied, not
  derived from the message text, so it reflects poster intent rather than an
  objective classifier.
- **Pending data:** MU and SNDK end at 2026-03-18 and need an update to
  2026-05-06.

## 6. From data to presentation

> _TODO: briefly note how the CSVs fed the analysis notebook and the slide deck
> (which metrics, which charts), so the pipeline is reproducible end to end._
