# Local Development Setup

This guide is for running the entire stack **locally on your machine**.

## Prerequisites

- Node.js (v16+)
- Python 3.9+
- MongoDB (local or Atlas)
- AWS Account (for S3)
- Gemini API Key

## Environment Configuration

All environment files are already configured for **localhost**:

### 1. Frontend (Port 5173)
**File**: `frontend/.env`
```env
VITE_API_URL=http://localhost:5001/api
```

### 2. Backend (Port 5001)
**File**: `backend/.env`
```env
PORT=5001
MONGODB_URI=mongodb+srv://your-connection-string
NODE_ENV=development

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
PRIVATE_KEY_ED25519=...
PUBLIC_KEY_ED25519=...

# Service URLs (localhost)
ML_SERVICE_URL=http://localhost:8000
FRONTEND_URL=http://localhost:5173

# App Config
UPLOAD_MAX_SIZE_MB=10
GRADE_CACHE_TTL_SECONDS=3600
```

### 3. ML Service (Port 8000)
**File**: `ml-service/.env`
```env
# AWS
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=secondlife-marketplace-uploads

# Gemini
GEMINI_API_KEY=...
GEMINI_MODEL_PRIMARY=gemini-2.5-flash-lite
GEMINI_MODEL_FALLBACK=gemini-2.0-flash

# Grading tunables
GRADE_CACHE_TTL_SECONDS=3600
GEMINI_TIMEOUT_SECONDS=10
PASS2_TIMEOUT_SECONDS=20
ANALYSIS_TIMEOUT_SECONDS=60
PHASH_HAMMING_THRESHOLD=10
CLIP_SUBJECT_MATCH_THRESHOLD=0.25
CLIP_MODEL_NAME=openai/clip-vit-base-patch32
```

## Starting the Services

### Terminal 1: ML Service (Python/FastAPI)
```bash
cd ml-service
pip install -r requirements.txt  # First time only
uvicorn app.main:app --reload --port 8000
```
**Runs at**: http://localhost:8000

### Terminal 2: Backend (Node.js/Express)
```bash
cd backend
npm install  # First time only
npm start
```
**Runs at**: http://localhost:5001

### Terminal 3: Frontend (React/Vite)
```bash
cd frontend
npm install  # First time only
npm run dev
```
**Runs at**: http://localhost:5173

## Verification

1. **ML Service Health**:
   ```bash
   curl http://localhost:8000/health
   ```
   Should return: `{"service":"ml-service","status":"ok"}`

2. **Backend Health**:
   ```bash
   curl http://localhost:5001/api/health
   ```
   Should return: `{"status":"OK"}`

3. **Frontend**: 
   Open http://localhost:5173 in your browser

4. **Test Gemini API**:
   - Open the app at http://localhost:5173
   - Click "Dev Bypass" button (bottom right)
   - Click "Test Gemini API"
   - Should show success if everything is configured correctly

## Common Issues

### "ML service not running (ECONNREFUSED)"
- Make sure ML service is running on port 8000
- Check `ML_SERVICE_URL` in `backend/.env` is `http://localhost:8000`

### "Gemini API failed"
- Check `GEMINI_API_KEY` is set in `ml-service/.env`
- Verify the API key is valid and has quota remaining
- Check the error message in DevTools for specifics

### Port Already in Use
If you get `EADDRINUSE` errors:

**Port 8000 (ML Service)**:
```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Or use a different port:
uvicorn app.main:app --reload --port 8001
# Then update ML_SERVICE_URL in backend/.env to http://localhost:8001
```

**Port 5001 (Backend)**:
```bash
# Windows
netstat -ano | findstr :5001
taskkill /PID <PID> /F

# Or change PORT in backend/.env
```

**Port 5173 (Frontend)**:
```bash
# Vite will auto-increment to 5174 if 5173 is taken
```

## Switching Between Local and Production

### To use LOCAL (current setup):
```env
# backend/.env
ML_SERVICE_URL=http://localhost:8000
FRONTEND_URL=http://localhost:5173

# frontend/.env
VITE_API_URL=http://localhost:5001/api
```

### To use PRODUCTION (Render/Vercel):
```env
# backend/.env
ML_SERVICE_URL=https://your-ml-service.onrender.com
FRONTEND_URL=https://your-frontend.vercel.app

# frontend/.env
VITE_API_URL=https://your-backend.onrender.com/api
```

## Quick Commands

```bash
# Start everything at once (requires 3 terminals)
# Terminal 1: cd ml-service && uvicorn app.main:app --reload --port 8000
# Terminal 2: cd backend && npm start
# Terminal 3: cd frontend && npm run dev

# Stop everything: Ctrl+C in each terminal

# View logs: Check each terminal for output
```

## Environment Variables Checklist

Before starting, make sure you have:
- ✅ `MONGODB_URI` - Your MongoDB connection string
- ✅ `GEMINI_API_KEY` - Your Google Gemini API key
- ✅ `AWS_ACCESS_KEY_ID` - Your AWS access key
- ✅ `AWS_SECRET_ACCESS_KEY` - Your AWS secret key
- ✅ `CLERK_SECRET_KEY` - Your Clerk secret key
- ✅ `S3_BUCKET_NAME` - Your S3 bucket name

All other variables have sensible defaults for local development.
