import json
import time
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import pandas as pd


YAHOO_CHART_ENDPOINTS = [
    "https://query1.finance.yahoo.com/v8/finance/chart",
    "https://query2.finance.yahoo.com/v8/finance/chart",
]

YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
}


def normalize_idx_ticker(ticker: str) -> str:
    raw = (ticker or '').strip().upper()
    if not raw:
        raise ValueError("Ticker is required. Example: BBRI or BBRI.JK")

    if raw.endswith('.JK'):
        return raw

    if raw.isalnum() and 2 <= len(raw) <= 8:
        return f"{raw}.JK"

    raise ValueError("Only Indonesian IDX tickers are supported. Use BBRI or BBRI.JK")


def fetch_history(ticker: str, period: str):
    normalized_ticker = normalize_idx_ticker(ticker)
    params = {
        "range": period,
        "interval": "1d",
        "events": "history",
        "includeAdjustedClose": "true",
    }
    payload = None
    last_error = None

    for base_url in YAHOO_CHART_ENDPOINTS:
        url = f"{base_url}/{normalized_ticker}?{urlencode(params)}"
        for attempt in range(3):
            try:
                request = Request(url, headers=YAHOO_HEADERS)
                with urlopen(request, timeout=15) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                    break
            except HTTPError as exc:
                last_error = exc
                if exc.code == 429 and attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    continue
            except URLError as exc:
                last_error = exc
                if attempt < 2:
                    time.sleep(1.0 * (attempt + 1))
                    continue
            except Exception as exc:
                last_error = exc
            break

        if payload is not None:
            break

    if payload is None:
        if isinstance(last_error, HTTPError):
            raise ValueError(f"Yahoo request failed for {normalized_ticker}: HTTP {last_error.code}") from last_error
        if isinstance(last_error, URLError):
            raise ValueError(f"Network error while fetching {normalized_ticker}: {last_error.reason}") from last_error
        raise ValueError(f"Failed to fetch market data for {normalized_ticker}")

    chart = payload.get("chart", {})
    result_list = chart.get("result") or []
    if not result_list:
        raise ValueError(f"No market data found for ticker {normalized_ticker}")

    result = result_list[0]
    timestamps = result.get("timestamp") or []
    quote_items = (result.get("indicators", {}).get("quote") or [])
    if not timestamps or not quote_items:
        raise ValueError(f"No market data found for ticker {normalized_ticker}")

    quote = quote_items[0]
    df = pd.DataFrame(
        {
            "Open": quote.get("open") or [],
            "High": quote.get("high") or [],
            "Low": quote.get("low") or [],
            "Close": quote.get("close") or [],
            "Volume": quote.get("volume") or [],
        },
        index=[datetime.utcfromtimestamp(ts) for ts in timestamps],
    )

    history = df.dropna()
    if history.empty:
        raise ValueError(f"No market data found for ticker {normalized_ticker}")

    return history
