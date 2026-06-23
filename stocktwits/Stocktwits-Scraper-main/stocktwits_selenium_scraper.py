"""
StockTwits Selenium Scraper - browser-based FALLBACK.

Drives a headless Chrome browser, scrolls the StockTwits website, and parses
the rendered HTML. This is the FALLBACK scraper, used when the API
(stocktwits_api_scraper.py) rate-limits or won't expose enough history for a
symbol. The API scraper is preferred — it is ~10x faster and more reliable.

Requirements:
    pip install selenium beautifulsoup4 python-dateutil webdriver-manager pandas

Public interface
----------------
    scraper = ImprovedStockTwitsScraper(headless=True)
    messages = scraper.scrape_symbol_comprehensive('LITE', date(2026, 1, 8), date(2026, 1, 26))
    scraper.save_to_csv(messages, 'lite.csv')
    scraper.close()
"""

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from bs4 import BeautifulSoup
import csv
import time
import random
from datetime import datetime, date
from typing import List, Dict, Optional
from dateutil import parser as date_parser
import pandas as pd

try:
    from webdriver_manager.chrome import ChromeDriverManager
    USE_WEBDRIVER_MANAGER = True
except ImportError:
    USE_WEBDRIVER_MANAGER = False


class ImprovedStockTwitsScraper:
    def __init__(self, headless: bool = True):
        """
        Initialize the improved StockTwits scraper

        Args:
            headless: Run browser in headless mode
        """
        self.driver = None
        self.base_url = "https://stocktwits.com"
        self.headless = headless
        self._setup_driver()

    def _setup_driver(self):
        """Setup Chrome WebDriver with optimized settings"""
        chrome_options = Options()
        if self.headless:
            chrome_options.add_argument('--headless=new')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-blink-features=AutomationControlled')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--window-size=1920,1080')
        chrome_options.add_argument('user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

        # Hide automation flags
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)

        if USE_WEBDRIVER_MANAGER:
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
        else:
            self.driver = webdriver.Chrome(options=chrome_options)

        # Hide webdriver property
        self.driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
            'source': '''
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                })
            '''
        })

        self.driver.implicitly_wait(10)

    def _human_delay(self, min_sec: float = 0.5, max_sec: float = 2.0):
        """Sleep for a random duration"""
        time.sleep(random.uniform(min_sec, max_sec))

    def _aggressive_scroll(self):
        """Aggressively scroll to load more content with varied patterns"""
        # Scroll to bottom
        self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        self._human_delay(2.0, 3.0)  # Increased wait time

        # Scroll up a bit and back down (triggers lazy loading)
        self.driver.execute_script("window.scrollBy(0, -500);")
        self._human_delay(0.5, 0.8)
        self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        self._human_delay(2.0, 3.0)  # Increased wait time

        # Extra scroll at the end for stubborn content
        self.driver.execute_script("window.scrollBy(0, 100);")
        self._human_delay(0.5, 1.0)

    def scrape_symbol_comprehensive(self, symbol: str, start_date: date, end_date: date) -> List[Dict]:
        """
        Comprehensively scrape messages for a symbol within date range

        Args:
            symbol: Stock symbol (e.g., 'LITE', 'COHR')
            start_date: Start date (inclusive)
            end_date: End date (inclusive)

        Returns:
            List of message dictionaries
        """
        messages = []
        seen_message_ids = set()
        url = f"{self.base_url}/symbol/{symbol.upper()}"

        print(f"\n{'='*60}")
        print(f"Scraping ${symbol.upper()}")
        print(f"Target date range: {start_date} to {end_date}")
        print(f"{'='*60}\n")

        try:
            self.driver.get(url)
            self._human_delay(3, 4)

            # Wait for messages to load
            WebDriverWait(self.driver, 15).until(
                EC.presence_of_element_located((By.TAG_NAME, "article"))
            )

            scroll_count = 0
            no_new_content_count = 0
            messages_in_range = 0
            messages_before_range = 0
            last_message_count = 0

            # Much more patient limits - INCREASED for better coverage
            MAX_NO_NEW_CONTENT = 50  # Increased from 30
            MAX_BEFORE_RANGE = 30  # Stop after this many consecutive messages before start_date
            MAX_SCROLLS = 300  # Absolute maximum scrolls

            oldest_date_seen = None
            reached_target_range = False

            while scroll_count < MAX_SCROLLS:
                scroll_count += 1

                # Parse current page
                soup = BeautifulSoup(self.driver.page_source, 'html.parser')

                # Find message elements
                all_articles = soup.find_all('article')
                message_elements = [
                    art for art in all_articles
                    if art.get('class') and any('StreamMessage_article' in str(c) for c in art.get('class', []))
                ]

                if not message_elements:
                    message_elements = all_articles

                # Track messages found this scroll
                new_messages_this_scroll = 0
                consecutive_before = 0

                for element in message_elements:
                    message_data = self._extract_message_data(element, symbol)
                    if not message_data:
                        continue

                    # Check for duplicates
                    message_id = message_data.get('link', '') + message_data.get('timestamp', '')
                    if message_id in seen_message_ids:
                        continue
                    seen_message_ids.add(message_id)

                    # Parse date
                    msg_date = self._parse_message_date(message_data.get('timestamp', ''))

                    if msg_date:
                        # Track oldest date we've seen
                        if oldest_date_seen is None or msg_date < oldest_date_seen:
                            oldest_date_seen = msg_date

                        # Check if in target range
                        if start_date <= msg_date <= end_date:
                            messages.append(message_data)
                            new_messages_this_scroll += 1
                            messages_in_range += 1
                            reached_target_range = True
                            consecutive_before = 0
                            messages_before_range = 0
                        elif msg_date < start_date:
                            consecutive_before += 1
                            messages_before_range += 1
                        # msg_date > end_date: skip (too new)

                # Progress report
                if new_messages_this_scroll > 0 or scroll_count % 10 == 0:
                    print(f"[Scroll {scroll_count}] Total in range: {messages_in_range} | "
                          f"New this scroll: {new_messages_this_scroll} | "
                          f"Oldest date seen: {oldest_date_seen}")

                # Check stopping conditions

                # Stop if we've found messages in range and now seeing many before start_date
                if reached_target_range and messages_before_range >= MAX_BEFORE_RANGE:
                    print(f"\n✓ Found {messages_before_range} consecutive messages before {start_date}")
                    print(f"✓ Collected {messages_in_range} messages in target range")
                    break

                # Stop if oldest date is well before start_date and we have messages
                if oldest_date_seen and oldest_date_seen < start_date and messages_in_range > 0:
                    days_before = (start_date - oldest_date_seen).days
                    if days_before >= 3:  # 3 days before start date
                        print(f"\n✓ Reached {oldest_date_seen} (3+ days before {start_date})")
                        print(f"✓ Collected {messages_in_range} messages in target range")
                        break

                # Scroll and check for new content
                last_height = self.driver.execute_script("return document.body.scrollHeight")
                self._aggressive_scroll()
                new_height = self.driver.execute_script("return document.body.scrollHeight")

                # Check if page grew
                if new_height == last_height and len(messages) == last_message_count:
                    no_new_content_count += 1

                    if no_new_content_count >= MAX_NO_NEW_CONTENT:
                        if not reached_target_range:
                            print(f"\n⚠ No new content after {MAX_NO_NEW_CONTENT} scrolls")
                            print(f"⚠ Never reached target date range (oldest: {oldest_date_seen})")
                        else:
                            print(f"\n✓ No new content after {MAX_NO_NEW_CONTENT} scrolls")
                            print(f"✓ Collected {messages_in_range} messages")
                        break
                else:
                    no_new_content_count = 0
                    last_message_count = len(messages)

                # Random longer pauses
                if scroll_count % 15 == 0:
                    print(f"   [Pausing for {2} seconds...]")
                    self._human_delay(2, 3)

            if scroll_count >= MAX_SCROLLS:
                print(f"\n⚠ Reached maximum scroll limit ({MAX_SCROLLS})")

            print(f"\n✓ Final count for ${symbol}: {len(messages)} messages")
            print(f"  Date range in data: {oldest_date_seen} to {end_date}")

        except Exception as e:
            print(f"\n✗ Error scraping ${symbol}: {e}")
            import traceback
            traceback.print_exc()

        return messages

    def _extract_message_data(self, element, symbol: str) -> Optional[Dict]:
        """Extract message data from a BeautifulSoup element"""
        try:
            message_data = {
                'symbol': symbol.upper(),
                'scraped_at': datetime.now().isoformat()
            }

            # Extract username
            username_elem = element.find('a', href=lambda x: x and '/user/' in str(x))
            if not username_elem:
                username_elem = element.find('a', href=lambda x: x and str(x).startswith('/') and
                                           not str(x).startswith('/symbol/') and
                                           not str(x).startswith('/message/'))

            if username_elem:
                username = username_elem.get_text(strip=True)
                if not username and username_elem.get('href'):
                    href = username_elem.get('href', '')
                    if href.startswith('/'):
                        parts = href.strip('/').split('/')
                        if parts and parts[0] != 'user':
                            username = parts[0]
                message_data['username'] = username if username else 'Unknown'
            else:
                link_elem = element.find('a', href=lambda x: x and '/message/' in str(x))
                if link_elem:
                    href = link_elem.get('href', '')
                    if '/message/' in href:
                        parts = href.split('/message/')[0].strip('/').split('/')
                        message_data['username'] = parts[-1] if parts and parts[-1] else 'Unknown'
                    else:
                        message_data['username'] = 'Unknown'
                else:
                    message_data['username'] = 'Unknown'

            # Extract message text
            text_elem = element.find('div', class_=lambda x: x and 'RichTextMessage' in ' '.join(x) if x else False)
            if not text_elem:
                text_elem = element.find('div', class_=lambda x: x and 'message' in ' '.join(x).lower() and
                                       'text' in ' '.join(x).lower() if x else False)
            if not text_elem:
                text_elem = element.find('p')
            if not text_elem:
                text_elem = element

            text = text_elem.get_text(separator=' ', strip=True) if text_elem else ''
            # Clean up text - remove sentiment labels
            text = text.replace('Bullish', '').replace('Bearish', '').strip()
            message_data['text'] = text

            # Extract timestamp
            time_elem = element.find('time')
            if not time_elem:
                time_elem = element.find('span', class_=lambda x: x and 'time' in ' '.join(x).lower() if x else False)

            message_data['timestamp'] = time_elem.get('datetime', '') or (time_elem.get_text(strip=True) if time_elem else '')

            # Extract sentiment
            sentiment_elem = element.find('span', class_=lambda x: x and 'sentimentText' in ' '.join(x) if x else False)
            if sentiment_elem:
                sentiment_text = sentiment_elem.get_text(strip=True).lower()
                if 'bullish' in sentiment_text:
                    message_data['sentiment'] = 'Bullish'
                elif 'bearish' in sentiment_text:
                    message_data['sentiment'] = 'Bearish'
                else:
                    message_data['sentiment'] = 'Neutral'
            else:
                # Check in text
                text_lower = text.lower()
                if 'bullish' in text_lower:
                    message_data['sentiment'] = 'Bullish'
                elif 'bearish' in text_lower:
                    message_data['sentiment'] = 'Bearish'
                else:
                    message_data['sentiment'] = 'Neutral'

            # Extract likes
            likes_elem = element.find('button', class_=lambda x: x and 'like' in ' '.join(x).lower() if x else False)
            if not likes_elem:
                likes_elem = element.find('span', class_=lambda x: x and 'like' in ' '.join(x).lower() if x else False)
            likes_text = likes_elem.get_text(strip=True) if likes_elem else '0'
            # Clean likes (might have text like "Like" in it)
            likes_clean = ''.join(filter(str.isdigit, likes_text)) or '0'
            message_data['likes'] = likes_clean

            # Extract link
            link_elem = element.find('a', href=lambda x: x and '/message/' in str(x))
            if link_elem:
                href = link_elem.get('href', '')
                message_data['link'] = self.base_url + href if not href.startswith('http') else href
            else:
                message_data['link'] = ''

            # Only return if we have actual text
            return message_data if message_data['text'] and len(message_data['text']) > 5 else None

        except Exception as e:
            return None

    def _parse_message_date(self, timestamp_str: str) -> Optional[date]:
        """Parse message timestamp to date object"""
        if not timestamp_str:
            return None

        try:
            # Try parsing ISO format first
            dt = date_parser.parse(timestamp_str)
            return dt.date()
        except:
            try:
                # Try various formats
                for fmt in ['%Y-%m-%d', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S']:
                    try:
                        dt = datetime.strptime(timestamp_str[:19], fmt)
                        return dt.date()
                    except:
                        continue
                return None
            except:
                return None

    def save_to_csv(self, messages: List[Dict], filename: str):
        """Save messages to CSV file"""
        if not messages:
            print("No messages to save")
            return

        # Use pandas for better CSV handling
        df = pd.DataFrame(messages)

        # Reorder columns
        column_order = ['symbol', 'username', 'text', 'timestamp', 'sentiment', 'likes', 'link', 'scraped_at']
        existing_cols = [col for col in column_order if col in df.columns]
        df = df[existing_cols]

        # Sort by timestamp
        df = df.sort_values('timestamp', ascending=False)

        df.to_csv(filename, index=False, encoding='utf-8')
        print(f"\n✓ Saved {len(messages)} messages to {filename}")

    def close(self):
        """Close the browser"""
        if self.driver:
            self.driver.quit()
