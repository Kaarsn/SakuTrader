# ⚡ Quick Deployment Checklist

## 🚀 ONE-STEP FIX FOR VERCEL "FAILED TO FETCH" ERROR

If your Vercel frontend shows "Failed to Fetch" when analyzing stocks, follow these steps **exactly**:

### Step 1: Go to Vercel Dashboard
1. Visit https://vercel.com/dashboard
2. Find your **AI-Analyst** project
3. Click on it to open

### Step 2: Add Environment Variable
1. Click **Settings** tab (top menu)
2. Click **Environment Variables** (left sidebar)
3. Click **Add New** button

### Step 3: Configure Backend URL
Fill in the form:
- **Name**: `NEXT_PUBLIC_API_BASE`
- **Value**: `https://ai-analyst-production-6dc9.up.railway.app`
- **Select**: Check all boxes (Production, Preview, Development)
- Click **Save**

### Step 4: Redeploy
1. Go to **Deployments** tab
2. Find the latest deployment (top of list)
3. Click the **...** (three dots) button on the right
4. Click **Redeploy**
5. Wait 2-3 minutes for build to complete
6. Done! ✅

---

## 🔍 Verification Steps

After redeploy is complete:

1. **Open your Vercel URL** in a browser
2. **Enter a ticker**: `BBRI` or `TLKM`
3. **Click Analyze**
4. **Should see**:
   - ✅ Stock chart with technical indicators
   - ✅ News section with 📰 articles (works out of the box!)
   - ✅ Sentiment badges (green/yellow/red)
   - ✅ Clickable "Baca Selengkapnya →" links

**📰 About News**: 
- News works by default with generated realistic articles
- No API key needed
- If you want real news from portals, see `DEPLOYMENT_GUIDE.md` for NewsAPI setup

---

## ❓ Still Getting "Failed to Fetch"?

### Check 1: Environment Variable Saved?
- Vercel → Settings → Environment Variables
- Look for `NEXT_PUBLIC_API_BASE` with Railway URL
- ❌ If NOT there → Go back to Step 3 above

### Check 2: Waited for Redeploy?
- Check Deployments page
- Look for "Ready" status (not "Building" or "Error")
- ⏳ If still building → Wait a few more minutes

### Check 3: Browser Cache?
- Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
- Or open in Incognito/Private window

### Check 4: Backend Running?
- Open in browser: `https://ai-analyst-production-6dc9.up.railway.app/api/analysis`
- Should show a JSON error (not connection error)

### Check 5: Check Browser Console
- Open DevTools: `F12` or `Ctrl+Shift+I`
- Look at **Console** tab (red X errors)
- Take screenshot and share error message

---

## 📁 Environment Variable Reference

### Frontend (Vercel)
```
NEXT_PUBLIC_API_BASE=https://ai-analyst-production-6dc9.up.railway.app
```

### Backend (Railway)
```
OPENAI_API_KEY=sk-...
NEWS_API_KEY=3e58215697154bb986091ee64391c4a6
ANALYTICS_SERVICE_URL=http://analytics:8000
PORT=4000
```

---

## 🎯 What This Does

**Before** (Broken):
- Vercel frontend tries to connect to `http://localhost:4000`
- localhost doesn't exist in the cloud ❌
- Result: "Failed to Fetch" error

**After** (Working):
- Vercel frontend connects to `https://ai-analyst-production-6dc9.up.railway.app`
- Backend responds with stock data ✅
- News loads from NewsAPI ✅
- Everything works! 🎉

---

## 📞 Need More Help?

See `DEPLOYMENT_GUIDE.md` for:
- Detailed troubleshooting
- Multi-device setup
- API key configuration
- Supported stocks list

---

**Last Updated**: 2024
© 2026 Muhammad Kaab Aryadilla
