# 🚨 Quick Fix for Vercel Deployment Error

## Your Error:
```
Gemini API failed
ML service not running at http://localhost:8000 (ECONNREFUSED)
```

## Why This Happens:
Your backend code is looking for the ML service at `localhost:8000`, but on Vercel there's no localhost - you need to tell it where your actual ML service is hosted!

---

## ✅ Fix in 3 Steps:

### Step 1: Go to Vercel Dashboard
1. Visit https://vercel.com/dashboard
2. Click on your **backend** project

### Step 2: Add Environment Variable
1. Click **Settings** (top menu)
2. Click **Environment Variables** (left sidebar)
3. Click **Add New**
4. Enter:
   - **Name:** `ML_SERVICE_URL`
   - **Value:** `https://second-life-ml.onrender.com`
5. Select: ✅ Production, ✅ Preview, ✅ Development
6. Click **Save**

### Step 3: Redeploy
1. Go to **Deployments** tab
2. Click the **"..."** menu on the latest deployment
3. Click **"Redeploy"**
4. Wait for deployment to complete (~30-60 seconds)

---

## 🔥 That's it! Your site should work now.

---

## 💡 Additional Variables You Should Add:

While you're in the Environment Variables section, add these too (see `VERCEL_ENV_SETUP.md` for full list):

**Critical ones:**
- `MONGODB_URI` - Your database connection
- `CLERK_SECRET_KEY` - Authentication
- `GEMINI_API_KEY` - AI features
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` - File uploads

**Without these, other features won't work!**

---

## 🐛 Still Not Working?

### Check if your ML service is actually running:
Open this URL in your browser:
```
https://second-life-ml.onrender.com/gemini/ping
```

- ✅ If you see a JSON response → ML service is up
- ❌ If you see an error → Your ML service on Render is down

### Make sure Render.com deployment is active:
1. Go to https://render.com/dashboard
2. Find your `second-life-ml` service
3. Make sure it says "Live" (not "Suspended")
4. Free tier services on Render sleep after 15 minutes of inactivity
5. Visit the URL above to wake it up (first request may take 30-60 seconds)

---

## 📝 Frontend Deployment:

If you're also deploying the frontend to Vercel, you need to set:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_cmVndWxhci1ibHVlamF5LTIwLmNsZXJrLmFjY291bnRzLmRldiQ
VITE_API_URL=https://your-backend.vercel.app/api
```

Replace `your-backend.vercel.app` with your actual backend Vercel domain!

