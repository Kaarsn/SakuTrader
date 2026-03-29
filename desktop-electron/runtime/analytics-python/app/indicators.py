import pandas as pd
from ta.momentum import RSIIndicator
from ta.trend import MACD


def calculate_indicators(df: pd.DataFrame):
    result = df.copy()
    result["ma20"] = result["Close"].rolling(window=20, min_periods=1).mean()
    result["ma50"] = result["Close"].rolling(window=50, min_periods=1).mean()

    rsi = RSIIndicator(close=result["Close"], window=14, fillna=True)
    result["rsi"] = rsi.rsi()

    macd = MACD(close=result["Close"], window_slow=26, window_fast=12, window_sign=9, fillna=True)
    result["macd"] = macd.macd()
    result["macd_signal"] = macd.macd_signal()
    result["macd_hist"] = macd.macd_diff()

    result = result.dropna(subset=["Open", "High", "Low", "Close", "Volume"])
    result[["rsi", "macd", "macd_signal", "macd_hist"]] = result[["rsi", "macd", "macd_signal", "macd_hist"]].fillna(0.0)
    if result.empty:
        raise ValueError("Not enough data to compute indicators")

    return result


def build_signals(last_row):
    rsi_value = float(last_row["rsi"])
    close = float(last_row["Close"])
    ma20 = float(last_row["ma20"])
    macd = float(last_row["macd"])
    macd_signal = float(last_row["macd_signal"])

    if rsi_value > 70:
        rsi_signal = "overbought"
    elif rsi_value < 30:
        rsi_signal = "oversold"
    else:
        rsi_signal = "neutral"

    trend_signal = "uptrend" if close > ma20 else "downtrend"
    macd_signal_name = "bullish" if macd > macd_signal else "bearish"

    return {
        "rsiSignal": rsi_signal,
        "trendSignal": trend_signal,
        "macdSignal": macd_signal_name,
    }
