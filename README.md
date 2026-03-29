# IDX AI Analyst Platform

A modular, scalable stock analysis platform focused on Indonesian stocks (e.g. `BUMI.JK`, `GOTO.JK`).

Ticker handling is Indonesia-first: you can input `BBRI` or `BBRI.JK`, and the system auto-normalizes to IDX format (`.JK`).

## Architecture

- `frontend-next` (Next.js + TypeScript): dashboard UI, comparison, charts, exports.
- `backend-node` (Node.js + Express): REST API gateway, auth, caching, recommendation logic, AI + news orchestration.
- `analytics-python` (FastAPI + pandas + ta + yfinance): market data fetch + technical indicator engine.

Communication is REST-based:

1. Frontend calls Node API.
2. Node API calls Python analytics service.
3. Node API calls OpenAI + News API (if keys available).

## Features Implemented

- Multi-ticker input and side-by-side comparison.
- Timeframes: 1 month, 3 months, 6 months.
- OHLC + volume + latest price.
- Indicators: RSI(14), MACD(12,26,9), MA20, MA50.
- Signals: overbought/oversold, uptrend/downtrend, bullish/bearish MACD.
- Candlestick chart + MA overlays + RSI/MACD charts.
- News integration (top 3-5) via NewsAPI.
- AI-generated sentiment + insight (OpenAI, with deterministic fallback).
- Recommendation engine: BUY / HOLD / SELL.
- Export analysis to JSON/CSV.
- In-memory caching and request rate limiting.
- Error handling for invalid ticker or missing data.
- Bonus: auth endpoints, portfolio endpoints, simple MA crossover backtesting endpoint.

## Project Structure

```text
stock-ai-platform/
  analytics-python/
  backend-node/
  frontend-next/
  .env.example
  docker-compose.yml
  README.md
```

## Local Run (Manual)

## 1) Python analytics service

```bash
cd analytics-python
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 2) Node backend service

```bash
cd backend-node
# PowerShell:
Copy-Item .env.example .env
# macOS/Linux:
# cp .env.example .env
npm install
npm run dev
```

## 3) Next.js frontend

```bash
cd frontend-next
# PowerShell:
Copy-Item .env.example .env.local
# macOS/Linux:
# cp .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000`.

## Local Run (Docker Compose)

```bash
docker compose up --build
```

## Desktop App (.exe) - Electron Launcher

Folder: `desktop-electron`

Launcher ini akan auto-start:

1. `analytics-python` (FastAPI, port 8000)
2. `backend-node` (Express, port 4000)
3. `frontend-next` (Next.js, port 3000)

Lalu membuka app pada window desktop.

### Prerequisites

- Semua dependency project sudah terinstall (`npm install` masing-masing service).
- Python environment untuk analytics tersedia.
- Untuk Windows default, launcher mencari Python di `../../.venv/Scripts/python.exe` dari root project.

### Jalankan Desktop Mode (dev)

```bash
cd desktop-electron
npm install
npm run dev
```

### Build ke .exe (Windows)

```bash
cd desktop-electron
npm install
npm run dist:win
```

Build desktop sekarang memakai runtime minimal (Next standalone + service files inti) untuk menekan ukuran output.

Output app ada di folder `desktop-electron/dist/IDX AI Analyst-win32-x64/`.
File executable: `desktop-electron/dist/IDX AI Analyst-win32-x64/IDX AI Analyst.exe`.
Jalankan `.exe` langsung dari folder tersebut (jangan pisahkan file `.exe` dari folder `resources`).

### Optional Env Overrides

- `ANALYTICS_PYTHON` = absolute path ke `python.exe`
- `DESKTOP_FRONTEND_MODE` = `dev` (default) atau `start`
- `DESKTOP_FRONTEND_PORT` (default `3000`)
- `DESKTOP_BACKEND_PORT` (default `4000`)
- `DESKTOP_ANALYTICS_PORT` (default `8000`)

Catatan:

- Launcher mencoba mendeteksi `.venv/Scripts/python.exe` otomatis.
- Jika tidak ketemu, set `ANALYTICS_PYTHON` ke path Python env yang berisi `uvicorn` dan dependency analytics.

## Key API Endpoints

- `POST /api/analysis`
  - body: `{ "tickers": ["BBRI", "TLKM", "GOTO.JK"], "timeframe": "3m" }`
- `POST /api/analysis/export`
  - body: `{ "format": "csv" | "json", "data": <analysis_response> }`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/portfolio` (Bearer token)
- `POST /api/portfolio` (Bearer token)
- `POST /api/backtest`

## Environment Variables

Root `.env.example` documents all keys. Most important:

- `OPENAI_API_KEY`
- `NEWS_API_KEY`
- `JWT_SECRET`
- `ANALYTICS_SERVICE_URL`
- `IDX_SUFFIX` (default `.JK`)
- `NEXT_PUBLIC_API_BASE`

## Deployment

## Frontend (Vercel)

- Root directory: `frontend-next`
- Env var: `NEXT_PUBLIC_API_BASE=https://<your-backend-domain>`

## Backend (Railway/Render)

Deploy as two services:

1. `analytics-python`
   - Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
2. `backend-node`
   - Start command: `npm start`
   - Set `ANALYTICS_SERVICE_URL` to Python service URL.

## Notes for Scaling

- Replace in-memory cache with Redis.
- Move in-memory auth/portfolio stores to PostgreSQL.
- Add queue-based enrichment for heavy AI/news workloads.
- Add websocket streaming for near-realtime chart updates.
