# IDX AI Analyst Platform

Platform analisis saham BEI/IDX berbasis web + desktop untuk screening multi-ticker, analisis teknikal, rekomendasi aksi, dan trade plan otomatis.

## Short

Dashboard analisis saham BEI berbasis Next.js + Node.js + FastAPI untuk multi-ticker screening, indikator teknikal, dan trade plan real-time.

## Fitur Utama

- Input multi ticker (contoh: `BBRI`, `TLKM`, `BUMI`).
- Normalisasi ticker IDX otomatis (`BBRI` -> `BBRI.JK`).
- Analisis teknikal: RSI, MACD, MA20, MA50, volume, trend.
- Rekomendasi: `BUY` / `HOLD` / `SELL`.
- Trade plan: entry zone, cut loss, TP1, TP2.
- Side-by-side comparison dan market rank.
- Export hasil ke JSON/CSV.
- Mode desktop via Electron.

Catatan: pipeline berita dinonaktifkan untuk meringankan backend.

## Arsitektur

- `frontend-next`: UI dashboard (Next.js + TypeScript)
- `backend-node`: REST API + logic rekomendasi (Node.js + Express)
- `analytics-python`: mesin indikator teknikal (FastAPI + pandas + ta + yfinance)

Alur:
1. Frontend memanggil backend API.
2. Backend meminta data teknikal ke service Python.
3. Backend mengembalikan insight + trade plan ke frontend.

## Struktur Proyek

```text
stock-ai-platform/
  analytics-python/
  backend-node/
  frontend-next/
  desktop-electron/
```

## Quick Start Lokal

Jalankan 3 service di terminal terpisah.

### 1) Analytics Python

```bash
cd analytics-python
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2) Backend Node

```bash
cd backend-node
Copy-Item .env.example .env
npm install
npm run dev
```

### 3) Frontend Next

```bash
cd frontend-next
Copy-Item .env.example .env.local
npm install
npm run dev
```

Buka: `http://localhost:3000`

## Environment Variable Penting

- `ANALYTICS_SERVICE_URL`
- `NEXT_PUBLIC_API_BASE`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `JWT_SECRET`

## Endpoint Inti

- `POST /api/analysis`
- `POST /api/analysis/export`
- `GET /api/analysis/market-rank`

Contoh body analisis:

```json
{
  "tickers": ["BBRI", "TLKM", "BUMI"],
  "timeframe": "1m",
  "strategy": "balanced"
}
```
