from fastapi import FastAPI, HTTPException

from .models import AnalyzeRequest
from .data_provider import fetch_history, normalize_idx_ticker
from .indicators import calculate_indicators, build_signals

app = FastAPI(title="Stock Analytics Service", version="1.0.0")


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "stock-analytics-python"}


@app.post("/analyze")
def analyze_stock(payload: AnalyzeRequest):
    try:
        normalized_ticker = normalize_idx_ticker(payload.ticker)
        df = fetch_history(normalized_ticker, payload.period)
        calculated = calculate_indicators(df)
        last = calculated.iloc[-1]

        candles = []
        for idx, row in calculated.tail(180).iterrows():
            candles.append(
                {
                    "time": idx.strftime("%Y-%m-%d"),
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"]),
                    "volume": float(row["Volume"]),
                    "ma20": float(row["ma20"]),
                    "ma50": float(row["ma50"]),
                    "rsi": float(row["rsi"]),
                    "macd": float(row["macd"]),
                    "macdSignal": float(row["macd_signal"]),
                    "macdHist": float(row["macd_hist"]),
                }
            )

        return {
            "ticker": normalized_ticker,
            "indicators": {
                "rsi": float(last["rsi"]),
                "macd": float(last["macd"]),
                "macdSignal": float(last["macd_signal"]),
                "ma20": float(last["ma20"]),
                "ma50": float(last["ma50"]),
            },
            "signals": build_signals(calculated),
            "candles": candles,
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analytics error: {exc}") from exc
