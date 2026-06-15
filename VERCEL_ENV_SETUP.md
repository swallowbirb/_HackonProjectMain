# Vercel Environment Variables Setup

## Quick Fix for Your Error 🚀

**The error "ML service not running at http://localhost:8000 (ECONNREFUSED)" happens because:**
- Your Vercel deployment doesn't have the `ML_SERVICE_URL` environment variable set
- It's defaulting to `localhost:8000` which doesn't exist in the cloud

**Solution:** Add the environment variables below to your Vercel project!

---

## Required Environment Variables for Vercel Deployment

### For BACKEND Deployment:
Add these environment variables in your Vercel project settings:
**Settings → Environment Variables**

### Core Configuration
```
NODE_ENV=production
PORT=5001
```

### MongoDB
```
MONGODB_URI=mongodb+srv://armandalli9999_db_user:XxDboALc5Dj3X4Kl@swallow0.tos7pva.mongodb.net/?appName=Swallow0
```

### Clerk Authentication
```
CLERK_PUBLISHABLE_KEY=pk_test_cmVndWxhci1ibHVlamF5LTIwLmNsZXJrLmFjY291bnRzLmRldiQ
CLERK_SECRET_KEY=sk_test_DxKm5Pz2K7yp0fzeLZmOrCkE358wHVrxmJk7KTQKp5
CLERK_WEBHOOK_SECRET=whsec_pQNVWTQPAB3U+zs3kJ7vFkPhgpgcQCr7
```

### AWS Configuration
```
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=AKIA3R74WY5VFUZRZ7FI
AWS_SECRET_ACCESS_KEY=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
S3_BUCKET_NAME=secondlife-marketplace-uploads
S3_UPLOAD_PREFIX=uploads
```

### Gemini AI
```
GEMINI_API_KEY=AQ.Ab8RN6KhwyfT3w5eDZX74hfHyvUxbzKw82-C_Xd1Sf2J3ID10w
GEMINI_MODEL_PRIMARY=gemini-2.5-flash-lite
GEMINI_MODEL_FALLBACK=gemini-2.0-flash
```

### Bedrock AI
```
BEDROCK_REGION=us-east-1
BEDROCK_MODEL_PRIMARY=amazon.nova-pro-v1:0
BEDROCK_MODEL_FALLBACK=anthropic.claude-3-5-sonnet-20241022-v2:0
```

### KMS / Signing Keys
```
KMS_KEY_ALIAS=secondlife-health-card-signing
PRIVATE_KEY_ED25519=MC4CAQAwBQYDK2VwBCIEIBS9NVJHyGDxzeUXo/NfOPcbaLUQURBPM9+D/SL7k5Qc
PUBLIC_KEY_ED25519=MCowBQYDK2VwAyEARRYN/4em6Cz1bJTcNqSx/PkBj8GnbCEk0sna0Csl19g=
```

### **🔥 CRITICAL: ML Service URL (This fixes your error!)**
```
ML_SERVICE_URL=https://second-life-ml.onrender.com
```

### App Configuration
```
UPLOAD_MAX_SIZE_MB=10
GRADE_CACHE_TTL_SECONDS=3600
```

---

## Steps to Apply:

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your **BACKEND** project
3. Go to **Settings** → **Environment Variables**
4. For each variable above:
   - Click "Add New"
   - Enter the Name and Value
   - Select all environments: Production, Preview, Development
   - Click "Save"

5. **Redeploy your application:**
   - Go to "Deployments" tab
   - Click the "..." menu on the latest deployment
   - Click "Redeploy"
   - OR: Push a new commit to trigger automatic redeployment

---

## Frontend Environment Variables (If Deploying Frontend Separately):

If you're deploying the frontend as a separate Vercel project, add these:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_test_cmVndWxhci1ibHVlamF5LTIwLmNsZXJrLmFjY291bnRzLmRldiQ
VITE_API_URL=https://your-backend-domain.vercel.app/api
```

**Replace `https://your-backend-domain.vercel.app` with your actual backend Vercel URL!**

---

## Important Notes:

- ⚠️ **Security Warning**: These are sensitive credentials. Only share with authorized team members.
- The `ML_SERVICE_URL` variable is what fixes the "ECONNREFUSED" error you're seeing.
- Make sure your ML service at `https://second-life-ml.onrender.com` is actually running and accessible.
- After adding all variables, you MUST redeploy for changes to take effect.

---

## Verify It's Working:

After redeployment, check:
1. Visit your Vercel domain
2. The error should be gone
3. Check browser console for any other errors
4. Test the Gemini API features

