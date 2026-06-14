# Developer Logs Sidebar — Feature Specification

> **Added to Phase 3.5:** Real-time flow visibility for debugging and understanding

---

## What It Is

A collapsible sidebar that appears on all return/secondhand flow pages, showing plain-English logs of what's happening at each step of the pipeline.

**Visual:**
```
┌────────────────────────────────┬──────────────────────┐
│                                │  DEVELOPER LOGS      │
│  Main Content Area             │  [← collapse button] │
│                                │                      │
│  [Evidence Upload Form]        │  🚀 INITIATE         │
│                                │  Return initiated... │
│  [Upload Photo]                │  10:23:45 AM        │
│  [Text Fields]                 │                      │
│                                │  🔍 TRUST START      │
│  [Submit Button]               │  Computing trust...  │
│                                │  10:23:45 AM        │
│                                │                      │
│                                │  ✅ TRUST COMPLETE   │
│                                │  Trust tier: STAN... │
│                                │  10:23:46 AM        │
│                                │                      │
│                                │  [auto-scrolls ↓]    │
└────────────────────────────────┴──────────────────────┘
       70% width                         30% width
```

---

## Why We Need It

**Problem:** During development and debugging, understanding what's happening in the multi-step flow is hard:
- Where did the flow break?
- How long did each step take?
- Why did a user get a specific trust tier?
- Which fraud signals triggered?
- Is Bedrock responding?

**Solution:** Plain-English logs visible in real-time alongside the UI.

---

## Log Examples (Plain English)

When a user completes a return flow, they see:

```
🚀 INITIATE
   Return initiated by user
   10:23:45 AM

🔍 TRUST START
   Computing user trust profile...
   10:23:45 AM

✅ TRUST COMPLETE
   Trust tier: STANDARD. Based on 12 purchases, 8% return rate.
   10:23:46 AM

✅ ITEM CREATED
   Item record created in database
   10:23:46 AM

📝 PASS1 START
   Generating customized evidence form...
   10:24:02 AM

🤖 PASS1 BEDROCK
   Calling Amazon Bedrock Nova Pro...
   10:24:02 AM

✅ PASS1 COMPLETE
   Evidence form generated with 5 fields (3 required)
   10:24:07 AM

📊 STATUS UPDATE
   Status changed to EVIDENCE_PENDING
   10:24:07 AM

📤 EVIDENCE SUBMIT
   Evidence submitted: 5 fields, 3 photos
   10:25:34 AM

⚙️ PASS2 START
   Starting AI grading analysis...
   10:25:34 AM

🛡️ FRAUD CHECK
   Running pre-flight fraud checks...
   10:25:35 AM

✅ FRAUD PASS
   ✓ No fraud signals detected
   10:25:38 AM

🔬 ANALYSIS PARALLEL
   Running OpenCV, CLIP, Rekognition, Textract...
   10:25:38 AM

✅ ANALYSIS COMPLETE
   Analysis complete: 2 defects found, 87% visual similarity
   10:25:45 AM

🤖 PASS2 BEDROCK
   Synthesizing final grade with Bedrock...
   10:25:45 AM

🎯 GRADE ASSIGNED
   Grade B assigned (78/100). Claim verified ✓
   10:25:52 AM

📊 STATUS UPDATE
   Status changed to GRADED
   10:25:52 AM

✨ FLOW COMPLETE
   ✓ Grading complete. Ready for routing.
   10:25:52 AM
```

---

## Technical Architecture

### Backend: ItemLogger Utility

**File:** `backend/src/utils/itemLogger.js`

```js
class ItemLogger {
  static async log(itemId, step, message, metadata = {}) {
    const logEntry = {
      itemId,
      step,
      message,
      metadata,
      timestamp: new Date()
    };
    
    // Persist to MongoDB
    await ItemLog.create(logEntry);
    
    // Console log for backend debugging
    console.log(`[${itemId}] ${step}: ${message}`);
    
    return logEntry;
  }
}
```

**Usage in code:**
```js
await ItemLogger.log(itemId, 'TRUST_COMPLETE', 
  `Trust tier: ${trustProfile.tier}. Based on ${trustProfile.lifetimePurchases} purchases.`,
  { tier: trustProfile.tier }
);
```

---

### MongoDB Schema

**Collection:** `itemLogs`

```js
{
  _id: ObjectId,
  itemId: ObjectId (indexed),
  step: String,
  message: String,
  metadata: Object,
  timestamp: Date (indexed, auto-expires after 7 days)
}
```

---

### Backend API

**Endpoint:** `GET /api/items/:itemId/logs`

**Response:**
```json
{
  "logs": [
    {
      "_id": "...",
      "itemId": "...",
      "step": "INITIATE",
      "message": "Return initiated by user",
      "metadata": { "userId": "...", "orderId": "..." },
      "timestamp": "2026-06-13T10:23:45.123Z"
    },
    // ... more logs
  ]
}
```

---

### Frontend Component

**File:** `frontend/src/components/DeveloperLogsSidebar.jsx`

**Features:**
- Polls `/api/items/:itemId/logs` every 2 seconds
- Auto-scrolls to latest log
- Collapsible (toggle button)
- Color-coded by log type:
  - ✅ Success = green
  - ⚙️ In Progress = blue
  - ⚠️ Warning = orange
  - ❌ Error = red
- Emoji icons for visual scanning

**Props:**
- None (gets `itemId` from URL params via `useParams()`)

---

## Log Points in the Flow

### 1. Return/Sell-Used Initiation
- `INITIATE` — User started return/listing
- `TRUST_START` — Computing trust profile
- `TRUST_COMPLETE` — Trust tier assigned
- `ITEM_CREATED` — Item record persisted

### 2. Grading Pass 1 (Form Generation)
- `PASS1_START` — Starting form generation
- `PASS1_BEDROCK` — Calling Bedrock
- `PASS1_COMPLETE` — Form schema returned
- `STATUS_UPDATE` — Status changed to EVIDENCE_PENDING

### 3. Evidence Collection
- `PHOTO_UPLOAD` — User uploading photo
- `PHOTO_VALIDATION` — Validating photo quality
- `EVIDENCE_SUBMIT` — User submitted evidence

### 4. Grading Pass 2 (Analysis)
- `PASS2_START` — Starting AI analysis
- `FRAUD_CHECK` — Running fraud checks
- `FRAUD_DETECTED` — Fraud signals found (if any)
- `FRAUD_PASS` — No fraud detected
- `ANALYSIS_PARALLEL` — Running OpenCV, CLIP, Rekognition, Textract
- `ANALYSIS_COMPLETE` — Analysis results ready
- `PASS2_BEDROCK` — Calling Bedrock for final grade
- `GRADE_ASSIGNED` — Grade assigned
- `STATUS_UPDATE` — Status changed to GRADED
- `FLOW_COMPLETE` — Ready for next phase

### 5. Errors
- `ERROR` — Any error with context

---

## Benefits

### For Developers:
1. **Instant debugging** — See exactly where the flow broke
2. **Timing visibility** — Identify slow steps (e.g., Bedrock taking 15s)
3. **Trust tier transparency** — Understand why a user got a specific tier
4. **Fraud signal visibility** — See which checks triggered
5. **No console diving** — All logs in one place, in order

### For Demo/Judging:
1. **Live AI showcase** — Judges can watch the AI working in real-time
2. **Trust layer proof** — Shows fraud checks actually running
3. **Technical depth** — Demonstrates system awareness and observability
4. **Debugging story** — "Built for real-world operation, not just demo"

---

## Optional Enhancements

### 1. Log Level Filtering
Add dropdown to filter:
- **All** — Every log
- **Key Steps** — Only START/COMPLETE/ASSIGNED
- **Errors Only** — Only ERROR logs

### 2. Export Logs
Button to download logs as JSON or text file for debugging

### 3. Real-time via WebSocket (instead of polling)
Use Socket.IO for true real-time updates (no 2-second delay)

### 4. Log Search
Search box to filter logs by keyword

### 5. Expandable Metadata
Click a log to see full metadata object

---

## Implementation Checklist

- [ ] Create `ItemLogger` utility class
- [ ] Create `ItemLog` MongoDB model with TTL index
- [ ] Add log emission to every major flow step (20+ log points)
- [ ] Create `GET /api/items/:itemId/logs` endpoint
- [ ] Build `DeveloperLogsSidebar` React component
- [ ] Add sidebar to evidence collection page
- [ ] Add sidebar to status page
- [ ] Test log polling (every 2s)
- [ ] Test auto-scroll to latest log
- [ ] Test collapsible toggle
- [ ] Test error logs display correctly
- [ ] Verify logs persist across page refresh
- [ ] Verify logs auto-expire after 7 days

---

## Code Locations

```
backend/
├── src/
│   ├── models/
│   │   └── itemLog.model.js           # NEW
│   ├── utils/
│   │   └── itemLogger.js              # NEW
│   └── routes/
│       └── items.routes.js            # Add GET /logs endpoint

frontend/
└── src/
    └── components/
        └── DeveloperLogsSidebar.jsx   # NEW (used on evidence & status pages)
```

---

## Testing Scenario

**Manual test:**
1. Start `npm run dev`
2. Navigate to `/returns/initiate`
3. Fill form and submit
4. Navigate to `/items/:id/evidence`
5. **Verify logs sidebar appears** on the right
6. **Verify logs show:**
   - "🚀 INITIATE — Return initiated..."
   - "✅ TRUST COMPLETE — Trust tier: STANDARD..."
7. **Upload a photo**
8. **Verify new log:** "📸 PHOTO_UPLOAD — Uploading photo 1..."
9. **Submit evidence**
10. **Watch logs update in real-time:**
    - "⚙️ PASS2 START — Starting AI analysis..."
    - "🛡️ FRAUD CHECK — Running fraud checks..."
    - "🔬 ANALYSIS PARALLEL — Running OpenCV, CLIP..."
    - "🎯 GRADE ASSIGNED — Grade B assigned..."
11. **Navigate to `/items/:id/status`**
12. **Verify logs sidebar shows full history**
13. **Click collapse button** → sidebar hides
14. **Refresh page** → logs persist

---

**End of Feature Spec.**

This is the single biggest DX (developer experience) improvement in Phase 3.5.
