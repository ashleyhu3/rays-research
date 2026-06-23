"""
StockTwits API Scraper - Fast and reliable using the official StockTwits API.

Collects messages for a ticker from the public StockTwits API
(https://api.stocktwits.com/api/2/streams/symbol/{SYMBOL}.json). No
authentication required. Paginates backwards from the newest message to a
target start date.

This is the primary scraper that produced the project's api_tweets_*.csv files.
For the browser-based fallback (used when the API rate-limits or won't expose
enough history), see stocktwits_selenium_scraper.py.

Requirements: curl (installed by default on macOS/Linux), pandas.

Public interface
----------------
    scraper = StockTwitsAPIScraper()
    messages = scraper.scrape_symbol('TSEM', date(2025, 9, 1), date(2026, 3, 18),
                                     max_requests=500)
    scraper.save_to_csv(messages, 'api_tweets_tsem.csv')
"""

import subprocess
import json
import pandas as pd
import time
from datetime import datetime, date
from typing import List, Dict, Optional


class StockTwitsAPIScraper:
    def __init__(self):
        self.base_url = "https://api.stocktwits.com/api/2/streams/symbol"

    def scrape_symbol(self, symbol: str, start_date: date, end_date: date, max_requests: int = 100) -> List[Dict]:
        """
        Scrape messages for a symbol using the API

        Args:
            symbol: Stock symbol (e.g., 'LITE', 'COHR')
            start_date: Start date (inclusive)
            end_date: End date (inclusive)
            max_requests: Maximum API requests to prevent infinite loops

        Returns:
            List of tweet dictionaries
        """
        messages = []
        url = f"{self.base_url}/{symbol.upper()}.json"
        max_id = None
        requests_made = 0

        print(f"\n{'='*60}")
        print(f"Scraping ${symbol.upper()} via API")
        print(f"Target: {start_date} to {end_date}")
        print(f"{'='*60}")

        while requests_made < max_requests:
            # Build URL with pagination
            request_url = url
            if max_id:
                request_url = f"{url}?max={max_id}"

            try:
                # Use curl to avoid blocking
                result = subprocess.run(
                    ['curl', '-s', request_url],
                    capture_output=True,
                    text=True,
                    timeout=30
                )

                if result.returncode != 0:
                    print(f"  ✗ Curl error: {result.stderr}")
                    break

                data = json.loads(result.stdout)
                requests_made += 1

                # Extract messages
                api_messages = data.get('messages', [])
                if not api_messages:
                    print(f"  No more messages. Stopping.")
                    break

                # Process each message
                messages_added = 0
                for msg in api_messages:
                    tweet_data = self._parse_message(msg, symbol)
                    if not tweet_data:
                        continue

                    # Check date range
                    tweet_date = self._parse_date(tweet_data['created_at'])
                    if not tweet_date:
                        continue

                    if tweet_date < start_date:
                        print(f"  Reached {tweet_date} (before {start_date}). Stopping.")
                        return messages

                    if start_date <= tweet_date <= end_date:
                        messages.append(tweet_data)
                        messages_added += 1

                # Get cursor for next page
                cursor = data.get('cursor', {})
                max_id = cursor.get('max')
                has_more = cursor.get('more', False)

                oldest_date = self._parse_date(api_messages[-1]['created_at'])
                print(f"  Request {requests_made}: +{messages_added} tweets | Total: {len(messages)} | Oldest: {oldest_date}")

                if not has_more or not max_id:
                    print(f"  No more pages available.")
                    break

                # Polite delay
                time.sleep(0.5)

            except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception) as e:
                print(f"  ✗ Error: {e}")
                break

        print(f"✓ Finished: {len(messages)} tweets collected for ${symbol}")
        return messages

    def _parse_message(self, msg: dict, symbol: str) -> Optional[Dict]:
        """Parse API message to our format"""
        try:
            # Extract user info
            user = msg.get('user', {})
            username = user.get('username', 'Unknown')
            user_followers = user.get('followers', 0)

            # Extract message body
            body = msg.get('body', '').strip()
            if not body:
                return None

            # Extract sentiment
            entities = msg.get('entities', {})
            sentiment_data = entities.get('sentiment', {})
            if sentiment_data:
                sentiment = sentiment_data.get('basic', 'Neutral').title()
            else:
                sentiment = 'Neutral'

            # Extract reshare count (how many times this post was reshared)
            reshare_data = msg.get('reshare_message', {})
            reshared_count = reshare_data.get('reshared_count', 0) if reshare_data else 0

            # Build StockTwits link
            message_id = msg.get('id', '')
            link = f"https://stocktwits.com/message/{message_id}" if message_id else ''

            return {
                'symbol': symbol.upper(),
                'username': username,
                'user_followers': user_followers,
                'text': body,
                'created_at': msg.get('created_at', ''),
                'timestamp': msg.get('created_at', ''),
                'sentiment': sentiment,
                'reshared_count': reshared_count,
                'link': link,
                'message_id': message_id,
                'scraped_at': datetime.now().isoformat()
            }

        except Exception as e:
            return None

    def _parse_date(self, timestamp_str: str) -> Optional[date]:
        """Parse ISO timestamp to date"""
        try:
            dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            return dt.date()
        except:
            return None

    def save_to_csv(self, messages: List[Dict], filename: str):
        """Save messages to CSV"""
        if not messages:
            print("No messages to save")
            return

        df = pd.DataFrame(messages)

        # Select and order columns
        columns = ['symbol', 'username', 'user_followers', 'text', 'timestamp', 'sentiment', 'reshared_count', 'link', 'message_id', 'scraped_at']
        df = df[columns]

        # Sort by timestamp (newest first)
        df = df.sort_values('timestamp', ascending=False)

        # Remove duplicates
        df = df.drop_duplicates(subset=['message_id'], keep='first')

        df.to_csv(filename, index=False, encoding='utf-8')
        print(f"\n✓ Saved {len(df)} unique tweets to {filename}")
