import pandas as pd
from ta.momentum import RSIIndicator
from ta.trend import MACD
import numpy as np


def calculate_indicators(df: pd.DataFrame):
    result = df.copy()
    
    # Moving Averages
    result.loc[:, "ma20"] = result["Close"].rolling(window=20, min_periods=1).mean()
    result.loc[:, "ma50"] = result["Close"].rolling(window=50, min_periods=1).mean()

    # RSI
    rsi = RSIIndicator(close=result["Close"], window=14, fillna=True)
    result.loc[:, "rsi"] = rsi.rsi()

    # MACD
    macd = MACD(close=result["Close"], window_slow=26, window_fast=12, window_sign=9, fillna=True)
    result.loc[:, "macd"] = macd.macd()
    result.loc[:, "macd_signal"] = macd.macd_signal()
    result.loc[:, "macd_hist"] = macd.macd_diff()

    # Bollinger Bands (20, 2 std dev)
    bb_middle_vals = result["Close"].rolling(window=20, min_periods=1).mean()
    bb_std_vals = result["Close"].rolling(window=20, min_periods=1).std().fillna(0)
    result.loc[:, "bb_middle"] = bb_middle_vals
    result.loc[:, "bb_upper"] = bb_middle_vals + (bb_std_vals * 2)
    result.loc[:, "bb_lower"] = bb_middle_vals - (bb_std_vals * 2)
    result.loc[:, "bb_width"] = result["bb_upper"] - result["bb_lower"]

    # Volume Analysis
    result.loc[:, "volume_ma"] = result["Volume"].rolling(window=20, min_periods=1).mean()
    result.loc[:, "volume_ratio"] = result["Volume"] / result["volume_ma"]

    # Fill NaN values
    result = result.fillna(0.0)
    result = result.dropna(subset=["Open", "High", "Low", "Close", "Volume"], how="any")
    
    if result.empty:
        raise ValueError("Not enough data to compute indicators")

    return result


def build_signals(calculated_df: pd.DataFrame):
    if len(calculated_df)< 1:
        raise ValueError("Not enough data for signal building")
        
    last_row = calculated_df.iloc[-1]
    prev_row = calculated_df.iloc[-2] if len(calculated_df) > 1 else last_row

    rsi_value = float(last_row["rsi"])
    close = float(last_row["Close"])
    ma20 = float(last_row["ma20"])
    ma50 = float(last_row["ma50"])
    prev_ma20 = float(prev_row["ma20"])
    prev_ma50 = float(prev_row["ma50"])
    macd = float(last_row["macd"])
    macd_signal = float(last_row["macd_signal"])
    
    # Bollinger Bands
    bb_upper = float(last_row["bb_upper"])
    bb_middle = float(last_row["bb_middle"])
    bb_lower = float(last_row["bb_lower"])
    bb_width = float(last_row["bb_width"])
    
    # Volume
    volume_ratio = float(last_row["volume_ratio"])

    if rsi_value > 70:
        rsi_signal = "overbought"
    elif rsi_value < 30:
        rsi_signal = "oversold"
    else:
        rsi_signal = "neutral"

    trend_signal = "uptrend" if close > ma20 else "downtrend"
    macd_signal_name = "bullish" if macd > macd_signal else "bearish"

    # Volume confirmation (volume spike = strong move)
    volume_strong = "yes" if volume_ratio > 1.5 else "no"
    
    # Bollinger Band squeeze (volume breakout setup alert)
    try:
        bb_width_history = calculated_df["bb_width"].dropna()
        if len(bb_width_history) > 50:
            avg_bb_width = bb_width_history.tail(50).mean()
        elif len(bb_width_history) > 0:
            avg_bb_width = bb_width_history.mean()
        else:
            avg_bb_width = bb_width
        squeeze_status = "squeeze" if bb_width < (avg_bb_width * 0.5) else "normal"
    except:
        squeeze_status = "normal"
    
    # Price position in Bollinger Bands
    if close > bb_upper:
        bb_position = "above_upper"
    elif close < bb_lower:
        bb_position = "below_lower"
    else:
        bb_position = "inside"

    crossed_up = prev_ma20 <= prev_ma50 and ma20 > ma50
    crossed_down = prev_ma20 >= prev_ma50 and ma20 < ma50
    if ma20 > ma50:
        cross_trend = "bullish"
    elif ma20 < ma50:
        cross_trend = "bearish"
    else:
        cross_trend = "neutral"

    if crossed_up:
        cross_signal = "golden_cross"
        cross_conclusion = "bullish"
    elif crossed_down:
        cross_signal = "death_cross"
        cross_conclusion = "bearish"
    else:
        cross_signal = "none"
        cross_conclusion = "neutral"

    return {
        "rsiSignal": rsi_signal,
        "trendSignal": trend_signal,
        "macdSignal": macd_signal_name,
        "crossSignal": cross_signal,
        "crossConclusion": cross_conclusion,
        "crossTrend": cross_trend,
        "volumeStrong": volume_strong,
        "bbSqueeze": squeeze_status,
        "bbPosition": bb_position,
        "volumeRatio": round(volume_ratio, 2),
    }
