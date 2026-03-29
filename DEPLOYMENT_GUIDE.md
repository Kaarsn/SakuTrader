# AI-Analyst Deployment Guide

## Overview
This guide covers deploying the AI-Analyst stock analysis platform to production with Vercel (frontend) and Railway (backend).

## Current Deployment Status

| Component | Service | URL | Status |
|-----------|---------|-----|--------|
| Frontend | Vercel | https://[your-vercel-domain].vercel.app | ✅ Deployed |
| Backend | Railway | https://ai-analyst-production-6dc9.up.railway.app | ✅ Deployed |
| Analytics | Railway (Python) | http://localhost:8000 | ✅ Local/Railway |

## Prerequisites

1. **GitHub Account** - For version control
2. **Vercel Account** - For frontend deployment (free tier sufficient)
3. **Railway Account** - For backend deployment (free tier sufficient)
4. **API Keys Ready**:
   - `NEXT_PUBLIC_API_BASE`: Backend URL (e.g., Railway URL)
   - `OPENAI_API_KEY`: From OpenAI API dashboard
   - `NEWS_API_KEY`: From NewsAPI.org
   - Backend Analytics Service URL

## Part 1: Backend Deployment (Railway)

### Option 1: Railway via GitHub (Recommended)

1. Push code to GitHub repo
2. Go to [Railway.app](https://railway.app)
3. Click "New Project" → "Deploy from GitHub"
4. Select your repository
5. Configure environment variables:
   ```
   OPENAI_API_KEY=sk-...
   NEWS_API_KEY=3e58215697154bb986091ee64391c4a6
   ANALYTICS_SERVICE_URL=http://analytics:8000
   PORT=4000
   ```
6. Deploy

### Option 2: Manual Railway Deployment

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Create new project
railway init

# Link to existing project (or create new)
railway link

# Deploy
railway up
```

### Verify Backend is Running

```bash
curl https://ai-analyst-production-6dc9.up.railway.app/api/analysis \
  -H "Content-Type: application/json" \
  -d '{"ticker":"BBRI","interval":"1d"}'
```

Expected response: Stock analysis data with news, indicators, etc.

## Part 2: Frontend Deployment (Vercel)

### Initial Setup

1. Go to [Vercel.com](https://vercel.com)
2. Click "Add New" → "Project"
3. Import GitHub repository
4. Framework: Next.js (auto-detected)
5. Root Directory: `frontend-next`
6. Click "Deploy"

### ✨ CRITICAL: Environment Variables Configuration

After initial deployment:

1. Go to **Vercel Dashboard** → Select your **AI-Analyst project**
2. Navigate to **Settings** → **Environment Variables**
3. Add NEW environment variable:
   - **Name**: `NEXT_PUBLIC_API_BASE`
   - **Value**: `https://ai-analyst-production-6dc9.up.railway.app`
   - **Applies to**: Production, Preview, Development
4. Click **"Save"**

### Deploy Latest Changes with Environment Variables

1. Go to **Vercel Dashboard** → **Deployments**
2. Find the latest deployment
3. Click the **three-dot menu** → **"Redeploy"**
4. Confirm redeploy (this will use the new environment variables)
5. Wait 2-3 minutes for the build to complete

### Verify Frontend is Working

1. Open your Vercel domain: `https://[your-project].vercel.app`
2. Enter ticker: `BBRI` or `TLKM`
3. Click **Analyze**
4. Verify:
   - ✅ Chart renders (technical indicators visible)
   - ✅ News section loads with real articles
   - ✅ Sentiment badges show (Positif/Optimis/Negatif)
   - ✅ "Baca Selengkapnya" links are clickable

## Part 3: Multi-Device Access (Local Network)

### Setup for Tablet/Phone Testing

**Desktop (Computer)**:
- Frontend: `http://192.168.1.X:3000` (local IP)
- Backend: `http://192.168.1.X:4000` (local IP)

**Android Tablet/Phone**:
1. Ensure device is on same WiFi network
2. Open browser
3. Navigate to: `http://[desktop-ip]:3000`
4. Should work without any backend configuration change

**How It Works**:
The `getApiBase()` function in `lib/api.ts` automatically detects the hostname:
```typescript
function getApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window !== 'undefined' && window.location) {
    return `http://${window.location.hostname}:4000`;  // Auto-detect
  }
  return 'http://localhost:4000';
}
```

## Part 4: API Configuration

### 📰 News Configuration (3 Options - All Optional)

**Status**: ✅ **Works by default with fallback news** (no setup needed!)

#### Option 1: Fallback News (FREE, ACTIVE BY DEFAULT) ✅ RECOMMENDED FOR START
- **What**: System generates realistic, contextual news based on sentiment patterns
- **Cost**: FREE
- **Setup**: No setup needed! Works immediately
- **Example**: "Bank Rakyat Indonesia Lapor Kenaikan Pendapatan Q1 2026"
- **Pros**: 
  - ✅ No API key needed
  - ✅ Always works
  - ✅ Good for demo/testing
  - ✅ Realistic sentiment analysis
- **Cons**: 
  - ❌ Not real news from actual portals
  - ❌ Generated content

#### Option 2: NewsAPI (PAID, OPTIONAL UPGRADE) 💰
- **What**: Real news from worldwide sources
- **Cost**: Free tier (100 requests/day), Paid from $25/month
- **Setup**:
  1. Go to [NewsAPI.org](https://newsapi.org)
  2. Sign up (free tier available)
  3. Copy your API key
  4. Add to `.env`: `NEWS_API_KEY=your_key_here`
- **Pros**:
  - ✅ Real news from actual sources
  - ✅ Multiple countries/languages
  - ✅ Professional solution
- **Cons**:
  - ❌ Paid for production use
  - ❌ API key required
  - ❌ Rate limits on free tier

#### Option 3: RSS Feeds (FREE, BETA) 
- **What**: Real news scraped from Indonesian news portal RSS feeds
- **Cost**: FREE
- **Status**: Currently in beta (some portal RSS feeds need updating)
- **Setup**: Will auto-try RSS feeds first, then fallback to Option 1
- **Supported**: Kontan.co.id, Bisnis.com, Investor.id
- **Pros**:
  - ✅ Real news
  - ✅ Free
  - ✅ Indonesian focused
- **Cons**:
  - ❌ Portals may change RSS URLs
  - ❌ Requires maintenance

**Current Recommendation**: Start with Option 1 (Fallback News) - it works great for development/demo. Upgrade to Option 2 (NewsAPI) if you need real news for production.

### OpenAI Setup (For AI Insights)

1. Get API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Add to backend .env:
   ```
   OPENAI_API_KEY=sk-...
   ```
3. Model used: `gpt-4o-mini` (cheap & fast)

### Supported Indonesian Stocks

Current aliases in code:
- BBRI, TLKM, GOTO, BBCA, BMRI, BUMI, INDF, ASII, UNVR, ADRO

Add more by editing `backend-node/src/services/newsService.js`:
```javascript
const COMPANY_ALIASES = {
  'NEWSTOCK': ['New Stock Name', 'Alias'],
  // ... add here
};
```

## Troubleshooting

### "Failed to Fetch" on Vercel Frontend

**Cause**: `NEXT_PUBLIC_API_BASE` not set in Vercel Environment Variables

**Solution**:
1. Go to Vercel → Settings → Environment Variables
2. Add `NEXT_PUBLIC_API_BASE=https://ai-analyst-production-6dc9.up.railway.app`
3. Redeploy (Deployments → three-dot → Redeploy)

### "Analytics service unreachable"

**Check**:
1. Is analytics Python service running?
   ```bash
   # Local dev
   cd analytics-python
   python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```
2. Is backend configured with correct ANALYTICS_SERVICE_URL?

### CORS Errors in Browser Console

**Solution**: Ensure backend has CORS enabled (should be by default in `server.js`):
```javascript
app.use(cors());
```

### News not showing up

**Check**:
1. News API key is active: https://newsapi.org/docs/status
2. Verify ticker is in COMPANY_ALIASES
3. Check backend logs for API errors

## File Reference

### Key Environment Files

| File | Purpose | Scope |
|------|---------|-------|
| `frontend-next/.env.local` | Local frontend config | Development only |
| `backend-node/.env` | Backend config | Local development |
| Vercel Dashboard | Production frontend config | Production |
| Railway Dashboard | Production backend config | Production |

### Important Code Files

| File | Purpose |
|------|---------|
| `frontend-next/lib/api.ts` | API client with lazy base URL detection |
| `backend-node/src/services/newsService.js` | News fetching and sentiment |
| `analytics-python/app/indicators.py` | Technical indicators (Bollinger, Volume, etc.) |
| `frontend-next/components/Dashboard.tsx` | Main UI component |

## Production Checklist

- [ ] Backend deployed to Railway with all env vars set
- [ ] Frontend deployed to Vercel from GitHub
- [ ] `NEXT_PUBLIC_API_BASE` set in Vercel Environment Variables
- [ ] Frontend redeployed after env var changes
- [ ] Backend health check passes (curl to /api/analysis)
- [ ] Frontend loads and can fetch analysis
- [ ] News appear in dashboard with sentiment badges
- [ ] Links to news articles are clickable
- [ ] Mobile/tablet access works on local network

## Future Enhancements

- [ ] Custom domain setup
- [ ] SSL/TLS certificate (automatic with Vercel)
- [ ] Analytics dashboard for usage tracking
- [ ] Additional technical indicators
- [ ] Support for more stocks/exchanges
- [ ] User authentication and saved portfolios

## Support

For issues:
1. Check logs: Vercel → Deployments → Details
2. Check Railway logs: Railway → Deployments → View Logs
3. Browser DevTools → Console tab for frontend errors

---

**Last Updated**: 2024
**Platform**: Next.js 15.5.14 + Express 4.21.2 + FastAPI 0.115.6
**Author**: Muhammad Kaab Aryadilla © 2026
