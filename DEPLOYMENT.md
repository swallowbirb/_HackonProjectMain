# Deployment Guide

This document explains how to configure environment variables for local development and production deployments.

## Architecture

- **Frontend**: Deployed on Vercel
- **Backend**: Deployed on Render
- **ML Service**: Deployed on Render

## Environment Variables Setup

### 1. Frontend (Vercel)

**File**: `frontend/.env`

```env
# Backend API URL
VITE_API_URL=https://your-backend.onrender.com/api
```

**Vercel Dashboard Configuration**:
1. Go to your Vercel project → Settings → Environment Variables
2. Add:
   - `VITE_API_URL` = `https://your-backend.onrender.com/api`

### 2. Backend (Render)

**File**: `backend/.env` (local development only)

**Render Dashboard Configuration**:
1. Go to your Render backend service → Environment tab
2. Add all variables from `backend/.env.example`:

```env
PORT=5001
MONGODB_URI=mongodb+srv://...
NODE_ENV=production

# Clerk Auth
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...

# AWS
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=secondlife-marketplace-uploads
S3_UPLOAD_PREFIX=uploads

# Gemini
GEMINI_API_KEY=...
GEMINI_MODEL_PRIMARY=gemini-2.5-flash-lite
GEMINI_MODEL_FALLBACK=gemini-2.0-flash

# KMS / Signing
KMS_KEY_ID=
KMS_KEY_ALIAS=secondlife-health-card-signing
PRIVATE_KEY_ED25519=...
PUBLIC_KEY_ED25519=...

# Service URLs
ML_SERVICE_URL=https://your-ml-service.onrender.com
FRONTEND_URL=https://your-frontend.vercel.app

# App Config
UPLOAD_MAX_SIZE_MB=10
GRADE_CACHE_TTL_SECONDS=3600
```

### 3. ML Service (Render)

**File**: `ml-service/.env` (local development only)

**Render Dashboard Configuration**:
1. Go to your Render ML service → Environment tab
2. Add all variables from `ml-service/.env`:

```env
# AWS
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=secondlife-marketplace-uploads
KMS_KEY_ID=

# Gemini
GEMINI_API_KEY=...
GEMINI_MODEL_PRIMARY=gemini-2.5-flash-lite
GEMINI_MODEL_FALLBACK=gemini-2.0-flash

# Phase 2 grading tunables
GRADE_CACHE_TTL_SECONDS=3600
GEMINI_TIMEOUT_SECONDS=10
PASS2_TIMEOUT_SECONDS=20
ANALYSIS_TIMEOUT_SECONDS=60
PHASH_HAMMING_THRESHOLD=10
CLIP_SUBJECT_MATCH_THRESHOLD=0.25
CLIP_MODEL_NAME=openai/clip-vit-base-patch32
```

## Local Development

For local development, use these URLs in your `.env` files:

**Frontend** (`frontend/.env`):
```env
VITE_API_URL=http://localhost:5001/api
```

**Backend** (`backend/.env`):
```env
ML_SERVICE_URL=http://localhost:8000
BACKEND_URL=http://localhost:5001
FRONTEND_URL=http://localhost:5173
```

**ML Service** (`ml-service/.env`):
```env
# ML service doesn't need URL configuration
```

## CORS Configuration

The backend automatically allows:
- Environment variable: `FRONTEND_URL`
- Environment variable: `BACKEND_URL`
- Local development: `localhost:5173`, `localhost:5174`, `localhost:3000`, `localhost:5001`
- All Vercel deployments: `*.vercel.app`
- All Render deployments: `*.onrender.com`

## Deployment Checklist

### After Deploying Backend to Render:
1. ✅ Add all environment variables in Render dashboard
2. ✅ Copy the Render backend URL
3. ✅ Update `BACKEND_URL` in Render backend environment
4. ✅ Update `VITE_API_URL` in Vercel frontend environment

### After Deploying ML Service to Render:
1. ✅ Add all environment variables in Render dashboard
2. ✅ Copy the Render ML service URL
3. ✅ Update `ML_SERVICE_URL` in Render backend environment

### After Deploying Frontend to Vercel:
1. ✅ Add `VITE_API_URL` in Vercel dashboard
2. ✅ Update `FRONTEND_URL` in Render backend environment

## Common Issues

### "ML service not running (ECONNREFUSED)"
- **Cause**: Backend can't reach ML service
- **Fix**: Check `ML_SERVICE_URL` in backend Render environment variables

### "Gemini API failed"
- **Cause**: Missing `GEMINI_API_KEY` in ML service
- **Fix**: Add `GEMINI_API_KEY` in ML service Render environment variables

### "CORS error"
- **Cause**: Frontend URL not allowed by backend
- **Fix**: Add `FRONTEND_URL` in backend Render environment variables

### "401 Unauthorized"
- **Cause**: Missing or invalid Clerk credentials
- **Fix**: Check `CLERK_SECRET_KEY` in backend Render environment variables

## Security Notes

- **Never commit `.env` files** to Git (they're in `.gitignore`)
- **Always use environment variables** in deployment platforms
- **Rotate secrets regularly** (especially API keys and database credentials)
- **Use different credentials** for development and production
