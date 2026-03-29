# 🚀 Production Deployment Guide - Vercel & Railway

## Quick Summary

```
LOCAL        → localhost:3000  (dev server)
PREVIEW      → Vercel preview URLs (PR testing)
PRODUCTION   → Vercel production domain (live app)
```

---

## Step 1: Git Setup (CRITICAL!)

### Create Separate Branches

```bash
# Main branch = PRODUCTION
git checkout main
git pull origin main

# Create staging branch (optional but recommended)
git checkout -b staging
git push origin staging

# Create dev branch (optional)
git checkout -b develop
git push origin develop
```

**Branch Strategy:**
- `main` → Production (auto-deploys to Vercel production)
- `staging` → Preview (for testing before main)
- `develop` → Development (daily work)

**NEVER push untested code to `main`!**

---

## Step 2: Vercel Project Setup

### Initial Connection

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New" → "Project"
3. Select GitHub repo
4. Configure:
   - **Framework**: Next.js
   - **Root Directory**: `frontend-next`
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `.next` (auto-detected)

5. Click "Deploy"

---

## Step 3: Environment Variables Setup (MOST IMPORTANT!)

### Location: Vercel Dashboard → Project Settings → Environment Variables

### Add Variables for EACH Environment

#### A) PRODUCTION Variables

Set for: **Production**

```
NEXT_PUBLIC_API_BASE
https://ai-analyst-production-6dc9.up.railway.app
```

**Why Production-specific:**
- Points to live Railway backend
- Users get real data
- 100% uptime requirement

#### B) PREVIEW Variables (Optional)

Set for: **Preview**

```
NEXT_PUBLIC_API_BASE
https://staging-backend.railway.app
```

Or same as production if testing

#### C) DEVELOPMENT Variables (Optional)

Set for: **Development**

```
NEXT_PUBLIC_API_BASE
http://localhost:4000
```

Only works on local machine

---

## Step 4: Environment Variable Application

### ✅ DO THIS IN VERCEL DASHBOARD:

1. **Settings** → **Environment Variables**
2. **Add New**:
   - **Name**: `NEXT_PUBLIC_API_BASE`
   - **Value**: `https://ai-analyst-production-6dc9.up.railway.app`
   - **Select environments**: Check ✅ **Production**, ✅ **Preview**, ✅ **Development**
   
3. Click **Save**

4. Variable now available to all environments

### ✅ Local Development (.env.local)

File: `frontend-next/.env.local`

```
NEXT_PUBLIC_API_BASE=http://localhost:4000
```

**This is LOCAL ONLY - not committed to git!**

---

## Step 5: Deployment Workflow

### Scenario A: Deploy to PRODUCTION

```bash
# 1. Test locally
npm run dev              # http://localhost:3000
# Test in browser - Ctrl+C when done

# 2. Commit changes
git add .
git commit -m "feat: add new feature"

# 3. Push to main branch
git push origin main

# 4. Vercel auto-deploys!
# Watch in Vercel Dashboard → Deployments
# Production deployment in ~2-3 minutes
```

### Scenario B: Deploy to PREVIEW (Test First)

```bash
# 1. Push to staging/preview branch (NOT main)
git checkout staging
git add .
git commit -m "test: new feature"
git push origin staging

# 2. Create Pull Request on GitHub
# - From: staging
# - To: main
# - Vercel will create PREVIEW deployment

# 3. Test preview URL in browser
# - Preview URL shown in PR

# 4. After testing, merge to main
# - This triggers PRODUCTION deployment
```

---

## Step 6: Monitoring & Rollback

### Check Deployment Status

1. Go to **Vercel Dashboard**
2. Select your project
3. Check **Deployments** tab
4. Look for:
   - ✅ Ready = Success!
   - ❌ Failed = Error (check logs)
   - ⏳ Building = Still deploying

### View Logs

1. Click on deployment
2. See **Build Logs** and **Runtime Logs**
3. Search for errors

### Rollback to Previous Version

1. **Deployments** tab
2. Find previous good deployment
3. Click **...** → **"Promote to Production"**
4. Done! Previous version is live

---

## Step 7: Backend (Railway) - Production Setup

### Environment Variables on Railway

Go to Railway → Project Settings → Variables

```
# Production Backend Environment
OPENAI_API_KEY=sk-...
NEWS_API_KEY=3e58215697154bb986091ee64391c4a6
ANALYTICS_SERVICE_URL=http://analytics:8000
PORT=4000
NODE_ENV=production
```

### Connecting Frontend to Backend

**Local (localhost:3000)**:
```
→ Backend: http://localhost:4000 (via .env.local)
```

**Production (Vercel)**:
```
→ Backend: https://ai-analyst-production-6dc9.up.railway.app (via Vercel env vars)
```

---

## Step 8: Common Issues & Fixes

### Issue: "Failed to Fetch" in Vercel

**Cause**: `NEXT_PUBLIC_API_BASE` not set or wrong value

**Fix**:
1. Vercel → Settings → Environment Variables
2. Add/update `NEXT_PUBLIC_API_BASE`
3. Redeploy: Deployments → **...** → **Redeploy**

### Issue: Changes not showing up

**Cause**: Old cached build

**Fix**:
```bash
# Force redeploy
Vercel Dashboard → Deployments → Latest → Redeploy
# Or hard refresh: Ctrl+Shift+R
```

### Issue: Preview URL shows 404

**Cause**: Preview env vars not set

**Fix**:
1. Check Environment Variables in Vercel
2. Preview scope might need separate config
3. Or just use production-config for preview

### Issue: Backend connection timeout

**Cause**: 
- Backend not running on Railway
- Firewall blocking
- Wrong URL in env

**Fix**:
1. Check Railway deployment is running
2. Test backend manually: `curl https://ai-analyst-production-6dc9.up.railway.app/api/analysis`
3. Verify env var URL is correct

---

## Step 9: Production Checklist

- [ ] Code pushed to `main` branch
- [ ] `NEXT_PUBLIC_API_BASE` set in Vercel (Production env)
- [ ] Backend deployed & running on Railway
- [ ] Frontend built successfully
- [ ] Deployment shows "Ready" (not "Failed")
- [ ] Test production URL in browser
- [ ] Test API call (analyze stock)
- [ ] News appears in dashboard
- [ ] Mobile device can access (public URL)
- [ ] No console errors (F12 → Console)

---

## Step 10: Auto-Deploy Strategy

### For Continuous Updates

**Option 1: Simple (All tests push to main)**
```
main branch → always Production
Risky if bugs slip through!
```

**Option 2: Safe (Test branch → merge to main)**
```
staging → Preview testing
  ↓ (after testing)
main → Production
Safer, more controlled
```

**Option 3: Advanced (Full CI/CD)**
```
develop (daily work) 
  ↓ PR to staging
staging (team testing)
  ↓ PR to main  
main (Production)
Most control, complex setup
```

---

## Summary: Quick Deploy

### For Production Release:

```bash
# 1. Test locally
cd frontend-next
npm run dev

# 2. When ready, push to main
git add .
git commit -m "Release v1.0.0: Add feature X"
git push origin main

# 3. Watch Vercel: Dashboard → Deployments
# Done! Live in 2-3 minutes

# 4. Verify at: https://your-vercel-domain.vercel.app
# Should show live app with real data from Railroad backend
```

---

## Important URLs

| Component | URL |
|-----------|-----|
| Frontend (Production) | https://your-vercel-domain.vercel.app |
| Backend API | https://ai-analyst-production-6dc9.up.railway.app |
| Vercel Dashboard | https://vercel.com/dashboard |
| Railway Dashboard | https://railway.app |

---

## Questions?

- "Did frontend deploy?" → Check Vercel Deployments tab
- "Is backend running?" → Curl `https://ai-analyst-production-6dc9.up.railway.app/health`
- "Why no data?" → Check `NEXT_PUBLIC_API_BASE` env var
- "How to rollback?" → Vercel Deployments → previous version → Promote

---

**Last Updated**: 2026-03-29
**Version**: 1.0
© Muhammad Kaab Aryadilla
