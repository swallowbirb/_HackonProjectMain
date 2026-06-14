# Phase 3.5 — Integration & End-to-End Testing

> **Goal:** Wire P1 (Dual Intake), P2 (AI Grading), and P3 (Trust Score) into a 
> working end-to-end flow with a functional frontend. Catch integration issues 
> before P4 adds routing complexity.

---

## Why This Phase Exists

You've built three independent systems in parallel:
- **P1** creates item records and manages state machines (backend)
- **P2** grades items using AI vision + Bedrock (FastAPI microservice)
- **P3** computes user trust profiles (backend)

They were designed to work together via agreed JSON contracts, but until you 
actually wire them with HTTP calls and build a UI to drive the flow, you won't 
find:
- Schema mismatches (field names, types, nesting)
- Missing error handling (Bedrock timeout, S3 upload failure)
- CORS issues (frontend ↔ backend ↔ FastAPI)
- State synchronization bugs (trust tier computed but not persisted)
- UX problems (loading states, error messages)

**P3.5 solves this before P4 (Routing) adds more complexity.**

---

## Success Criteria

**Done means:**
1. A user can initiate a return via the React frontend
2. The system fetches and displays their trust tier
3. Photos upload to S3 via pre-signed URLs
4. The AI grading pipeline runs (Pass 1 form schema → Pass 2 grade)
5. The Grade JSON appears on a status page
6. The full flow completes without crashes and persists correct data in MongoDB
7. The team can reset the demo state and re-run the flow cleanly

---

## What We Build

### 1. Backend Orchestration Layer (Express)

Create new endpoints that chain P1 → P3 → P2 together:

#### **POST `/api/returns/initiate`**
**Purpose:** Start a return from a past order.

**Request body:**
```json
{
  "userId": "user_abc123",
  "orderId": "order_xyz789",
  "lineItemId": "item_456",
  "reason": "Doesn't fit",
  "reasonCategory": "SIZE_ISSUE",
  "initialPhotos": ["https://s3.../photo1.jpg"]  // optional
}
```

**Flow:**
1. Validate the order exists and belongs to the user
2. Create an `Item` record (P1's domain):
   ```js
   {
     _id: generateId(),
     userId,
     orderId,
     productId: lineItem.productId,
     intakePath: "RETURN",
     status: "INITIATED",
     reason,
     reasonCategory,
     images: initialPhotos || [],
     createdAt: new Date()
   }
   ```
3. Compute trust profile (call P3's trust service):
   ```js
   const trustProfile = await trustService.computeTrustProfile(userId);
   ```
4. Persist trust profile reference in the item record
5. Log a lifecycle event:
   ```js
   {
     itemId: item._id,
     event: "INITIATED",
     timestamp: new Date(),
     metadata: { intakePath: "RETURN", reason }
   }
   ```

**Response:**
```json
{
  "itemId": "item_abc123",
  "status": "INITIATED",
  "trustTier": "STANDARD",
  "trustProfile": {
    "tier": "STANDARD",
    "lifetimePurchases": 12,
    "returnRate": 0.08,
    "accountAge": 456,
    "signals": []
  },
  "nextStep": "EVIDENCE_COLLECTION"
}
```

---

#### **POST `/api/secondhand/initiate`**
**Purpose:** Start a sell-used listing (two sub-flows).

**Request body (bought here):**
```json
{
  "userId": "user_abc123",
  "orderId": "order_xyz789",
  "lineItemId": "item_456",
  "reason": "Outgrown",
  "initialPhotos": []
}
```

**Request body (bought elsewhere):**
```json
{
  "userId": "user_abc123",
  "productId": "prod_123",  // or null if no catalog match
  "description": "Baby monitor, Philips Avent, 2 years old",
  "category": "BABY_GEAR",
  "reason": "No longer needed",
  "initialPhotos": []
}
```

**Flow:** Same as returns, but `intakePath: "SELL_USED"`.

**Response:** Same structure as `/returns/initiate`.

---

#### **POST `/api/grading/start`**
**Purpose:** Trigger the full AI grading pipeline (calls FastAPI).

**Request body:**
```json
{
  "itemId": "item_abc123"
}
```

**Flow:**
1. Fetch the item record from MongoDB
2. Fetch the product catalog data (brand, category, original listing photos)
3. Fetch the user's trust profile
4. Call FastAPI's `/grade/pass1` endpoint:
   ```
   POST http://localhost:8000/grade/pass1
   {
     "itemId": "item_abc123",
     "productId": "prod_123",
     "category": "ELECTRONICS",
     "reason": "Screen flicker",
     "initialPhotos": ["https://s3.../photo1.jpg"],
     "catalogData": { /* product fields */ }
   }
   ```
5. FastAPI returns a form schema (or cached schema if duplicate request)
6. Update item status to `EVIDENCE_PENDING`
7. Return the form schema to the frontend

**Response:**
```json
{
  "itemId": "item_abc123",
  "status": "EVIDENCE_PENDING",
  "pass1Schema": {
    "fields": [
      {
        "id": "screen_photo",
        "type": "photo",
        "label": "Photo of the screen turned on",
        "required": true,
        "validationHint": "Show the screen clearly lit"
      },
      {
        "id": "ports_photo",
        "type": "photo",
        "label": "Photo of all ports and connectors"
      },
      {
        "id": "describe_issue",
        "type": "text",
        "label": "Describe the screen flicker"
      }
    ]
  }
}
```

---

#### **POST `/api/grading/submit`**
**Purpose:** Submit the completed evidence form (triggers Pass 2).

**Request body:**
```json
{
  "itemId": "item_abc123",
  "evidenceData": {
    "screen_photo": "https://s3.../evidence1.jpg",
    "ports_photo": "https://s3.../evidence2.jpg",
    "describe_issue": "Flickers after 10 minutes of use"
  }
}
```

**Flow:**
1. Fetch the item + product + trust profile
2. Call FastAPI's `/grade/pass2` endpoint:
   ```
   POST http://localhost:8000/grade/pass2
   {
     "itemId": "item_abc123",
     "productId": "prod_123",
     "category": "ELECTRONICS",
     "catalogData": { /* ... */ },
     "evidencePhotos": ["https://s3.../evidence1.jpg", ...],
     "evidenceText": { "describe_issue": "Flickers after..." },
     "trustTier": "STANDARD"
   }
   ```
3. FastAPI runs:
   - Pre-flight fraud checks (imagehash, EXIF, Rekognition)
   - Parallel analysis (OpenCV, CLIP, Rekognition, Textract)
   - Bedrock Pass 2 (synthesizes Grade JSON)
4. FastAPI returns the full grade
5. Persist the grade in MongoDB:
   ```js
   {
     _id: generateId(),
     itemId: "item_abc123",
     grade: "B",
     qualityScore: 78,
     defects: ["Minor screen wear"],
     missingEvidence: [],
     returnClaimVerified: true,
     estimatedResalePct: 0.65,
     routingHint: "RESELL",
     rationale: "Item functions normally but shows minor cosmetic wear...",
     confidence: "HIGH",
     evidenceBundle: { /* full provenance */ },
     createdAt: new Date()
   }
   ```
6. Update item status to `GRADED`
7. Log lifecycle event

**Response:**
```json
{
  "itemId": "item_abc123",
  "status": "GRADED",
  "grade": {
    "grade": "B",
    "qualityScore": 78,
    "defects": ["Minor screen wear"],
    "returnClaimVerified": true,
    "estimatedResalePct": 0.65,
    "routingHint": "RESELL",
    "rationale": "Item functions normally but shows minor cosmetic wear...",
    "confidence": "HIGH"
  },
  "nextStep": "ROUTING"
}
```

---

#### **GET `/api/items/:itemId/status`**
**Purpose:** Unified status query (used by frontend to poll progress).

**Response:**
```json
{
  "itemId": "item_abc123",
  "status": "GRADED",
  "intakePath": "RETURN",
  "trustTier": "STANDARD",
  "grade": { /* Grade JSON if complete */ },
  "routingDecision": null,  // populated in P4
  "createdAt": "2026-06-13T10:00:00Z",
  "updatedAt": "2026-06-13T10:05:32Z"
}
```

---

### 2. Developer Logs Sidebar (Real-Time Flow Visibility)

**Goal:** Add a collapsible sidebar on all return/secondhand pages that shows plain-English logs of what's happening at each step. This helps developers understand the flow and debug issues without checking browser console or server logs.

#### **Architecture:**

**WebSocket-based real-time logging:**
- Backend emits log events via Socket.IO
- Frontend subscribes to logs for the current item
- Logs persist in memory (last 100 per item) for page refreshes

**Alternative (simpler for hackathon):**
- Backend writes logs to MongoDB `itemLogs` collection
- Frontend polls `GET /api/items/:itemId/logs` every 2 seconds
- Logs display in chronological order

---

#### **Backend: Log Emission System**

Create a logging utility (`backend/src/utils/itemLogger.js`):

```js
// backend/src/utils/itemLogger.js
const ItemLog = require('../models/itemLog.model');

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
    
    // Emit via Socket.IO if available
    if (global.io) {
      global.io.to(`item:${itemId}`).emit('log', logEntry);
    }
    
    // Console log for backend debugging
    console.log(`[${itemId}] ${step}: ${message}`);
    
    return logEntry;
  }
}

module.exports = ItemLogger;
```

**MongoDB schema (`backend/src/models/itemLog.model.js`):**
```js
const mongoose = require('mongoose');

const itemLogSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true, index: true },
  step: { type: String, required: true }, // e.g., "INITIATE", "TRUST_COMPUTE", "PASS1", etc.
  message: { type: String, required: true }, // Plain English message
  metadata: { type: Object, default: {} }, // Optional structured data
  timestamp: { type: Date, default: Date.now, index: true }
});

// Auto-delete logs older than 7 days
itemLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 604800 });

module.exports = mongoose.model('ItemLog', itemLogSchema);
```

**New endpoint (`GET /api/items/:itemId/logs`):**
```js
router.get('/items/:itemId/logs', async (req, res) => {
  const { itemId } = req.params;
  const logs = await ItemLog.find({ itemId })
    .sort({ timestamp: 1 })
    .limit(100)
    .lean();
  res.json({ logs });
});
```

---

#### **Log Points in the Flow**

**In `POST /api/returns/initiate`:**
```js
await ItemLogger.log(itemId, 'INITIATE', 'Return initiated by user', { 
  userId, orderId, reason 
});

await ItemLogger.log(itemId, 'TRUST_START', 'Computing user trust profile...');

const trustProfile = await trustService.computeTrustProfile(userId);

await ItemLogger.log(itemId, 'TRUST_COMPLETE', 
  `Trust tier: ${trustProfile.tier}. Based on ${trustProfile.lifetimePurchases} purchases, ${trustProfile.returnRate}% return rate.`,
  { tier: trustProfile.tier }
);

await ItemLogger.log(itemId, 'ITEM_CREATED', 'Item record created in database', { status: 'INITIATED' });
```

**In `POST /api/grading/start` (Pass 1):**
```js
await ItemLogger.log(itemId, 'PASS1_START', 'Generating customized evidence form...');

await ItemLogger.log(itemId, 'PASS1_BEDROCK', 'Calling Amazon Bedrock Nova Pro...', { 
  productId, category 
});

// After Bedrock returns
await ItemLogger.log(itemId, 'PASS1_COMPLETE', 
  `Evidence form generated with ${schema.fields.length} fields (${requiredCount} required)`,
  { fieldCount: schema.fields.length }
);

await ItemLogger.log(itemId, 'STATUS_UPDATE', 'Status changed to EVIDENCE_PENDING');
```

**In `POST /api/grading/submit` (Pass 2):**
```js
await ItemLogger.log(itemId, 'EVIDENCE_SUBMIT', 
  `Evidence submitted: ${Object.keys(evidenceData).length} fields, ${photoCount} photos`
);

await ItemLogger.log(itemId, 'PASS2_START', 'Starting AI grading analysis...');

await ItemLogger.log(itemId, 'FRAUD_CHECK', 'Running pre-flight fraud checks (imagehash, EXIF, Rekognition)...');

// After fraud checks
if (fraudSignals.length > 0) {
  await ItemLogger.log(itemId, 'FRAUD_DETECTED', 
    `⚠️ ${fraudSignals.length} fraud signal(s) detected: ${fraudSignals.join(', ')}`,
    { signals: fraudSignals }
  );
} else {
  await ItemLogger.log(itemId, 'FRAUD_PASS', '✓ No fraud signals detected');
}

await ItemLogger.log(itemId, 'ANALYSIS_PARALLEL', 'Running parallel analysis (OpenCV, CLIP, Rekognition, Textract)...');

await ItemLogger.log(itemId, 'ANALYSIS_COMPLETE', 
  `Analysis complete: ${defectsFound} defects found, visual similarity ${similarity}%`
);

await ItemLogger.log(itemId, 'PASS2_BEDROCK', 'Synthesizing final grade with Bedrock...');

// After grade returns
await ItemLogger.log(itemId, 'GRADE_ASSIGNED', 
  `Grade ${grade.grade} assigned (${grade.qualityScore}/100). ${grade.returnClaimVerified ? 'Claim verified ✓' : 'Claim not verified ✗'}`,
  { grade: grade.grade, score: grade.qualityScore }
);

await ItemLogger.log(itemId, 'STATUS_UPDATE', 'Status changed to GRADED');

await ItemLogger.log(itemId, 'FLOW_COMPLETE', '✓ Grading complete. Ready for routing.');
```

**Error logging:**
```js
try {
  // ... API call
} catch (error) {
  await ItemLogger.log(itemId, 'ERROR', 
    `❌ Error in ${step}: ${error.message}`,
    { error: error.stack }
  );
  throw error;
}
```

---

#### **Frontend: Developer Logs Sidebar**

**Component (`frontend/src/components/DeveloperLogsSidebar.jsx`):**

```jsx
import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';

function DeveloperLogsSidebar() {
  const { itemId } = useParams();
  const [logs, setLogs] = useState([]);
  const [isOpen, setIsOpen] = useState(true);
  const logsEndRef = useRef(null);

  // Poll for logs every 2 seconds
  useEffect(() => {
    if (!itemId) return;
    
    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/items/${itemId}/logs`);
        const data = await res.json();
        setLogs(data.logs);
      } catch (error) {
        console.error('Failed to fetch logs:', error);
      }
    };

    fetchLogs(); // Initial fetch
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [itemId]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getStepIcon = (step) => {
    const icons = {
      INITIATE: '🚀',
      TRUST_START: '🔍',
      TRUST_COMPLETE: '✅',
      PASS1_START: '📝',
      PASS1_BEDROCK: '🤖',
      PASS1_COMPLETE: '✅',
      EVIDENCE_SUBMIT: '📤',
      PASS2_START: '⚙️',
      FRAUD_CHECK: '🛡️',
      FRAUD_DETECTED: '⚠️',
      FRAUD_PASS: '✅',
      ANALYSIS_PARALLEL: '🔬',
      ANALYSIS_COMPLETE: '✅',
      PASS2_BEDROCK: '🤖',
      GRADE_ASSIGNED: '🎯',
      STATUS_UPDATE: '📊',
      FLOW_COMPLETE: '✨',
      ERROR: '❌'
    };
    return icons[step] || '•';
  };

  const getStepColor = (step) => {
    if (step.includes('ERROR')) return 'text-red-600';
    if (step.includes('COMPLETE') || step.includes('PASS')) return 'text-green-600';
    if (step.includes('START') || step.includes('PENDING')) return 'text-blue-600';
    if (step.includes('WARNING') || step.includes('FRAUD_DETECTED')) return 'text-orange-600';
    return 'text-gray-700';
  };

  return (
    <div className={`fixed right-0 top-0 h-full bg-gray-900 text-gray-100 transition-transform duration-300 ${isOpen ? 'w-96' : 'w-12'} shadow-2xl z-50`}>
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="absolute left-0 top-4 -ml-10 bg-gray-900 text-white px-3 py-2 rounded-l-lg hover:bg-gray-800"
      >
        {isOpen ? '→' : '←'}
      </button>

      {isOpen && (
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-lg font-bold">Developer Logs</h3>
            <p className="text-xs text-gray-400 mt-1">Real-time flow visibility</p>
          </div>

          {/* Logs container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs">
            {logs.length === 0 ? (
              <div className="text-gray-500 text-center mt-8">
                No logs yet. Start a return or listing.
              </div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <span className="text-lg flex-shrink-0">
                    {getStepIcon(log.step)}
                  </span>
                  <div className="flex-1">
                    <div className={`font-semibold ${getStepColor(log.step)}`}>
                      {log.step.replace(/_/g, ' ')}
                    </div>
                    <div className="text-gray-300 mt-1">
                      {log.message}
                    </div>
                    <div className="text-gray-500 text-xs mt-1">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-gray-700 text-xs text-gray-500">
            {logs.length} log entries
          </div>
        </div>
      )}
    </div>
  );
}

export default DeveloperLogsSidebar;
```

**Add to all return/secondhand pages:**
```jsx
// In evidence page, status page, etc.
import DeveloperLogsSidebar from '../components/DeveloperLogsSidebar';

function EvidenceCollectionPage() {
  return (
    <div className="flex">
      <div className="flex-1">
        {/* Main content */}
      </div>
      <DeveloperLogsSidebar />
    </div>
  );
}
```

---

#### **Example Log Flow (Plain English)**

When a user initiates a return and completes grading, they'll see:

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
   Running pre-flight fraud checks (imagehash, EXIF, Rekognition)...
   10:25:35 AM

✅ FRAUD PASS
   ✓ No fraud signals detected
   10:25:38 AM

🔬 ANALYSIS PARALLEL
   Running parallel analysis (OpenCV, CLIP, Rekognition, Textract)...
   10:25:38 AM

✅ ANALYSIS COMPLETE
   Analysis complete: 2 defects found, visual similarity 87%
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

#### **Benefits:**

1. **Instant debugging** — See exactly where the flow breaks
2. **Timing visibility** — Understand which steps are slow (Bedrock, S3, etc.)
3. **Trust tier transparency** — See why a user got a specific tier
4. **Fraud signal visibility** — See which checks triggered warnings
5. **Demo polish** — Judges/stakeholders can watch the AI working in real-time

---

#### **Optional Enhancement: Log Levels**

Add a filter dropdown to show:
- **All** (everything)
- **Key Steps** (only START/COMPLETE/ASSIGNED)
- **Errors Only** (only ERROR logs)

```jsx
const [logLevel, setLogLevel] = useState('all');

const filteredLogs = logs.filter(log => {
  if (logLevel === 'errors') return log.step.includes('ERROR');
  if (logLevel === 'key') return log.step.includes('COMPLETE') || log.step.includes('ASSIGNED') || log.step.includes('START');
  return true;
});
```

---

### 3. Frontend Pages (React)

Build four key pages to drive the flow:

#### **Page 1: Returns Initiation (`/returns/initiate`)**

**UI elements:**
- Header: "Initiate a Return"
- Order picker: dropdown showing user's past orders (fetch from `/api/orders?userId=...`)
- Line item picker: shows products in the selected order
- Reason dropdown: pre-populated categories (SIZE_ISSUE, DEFECT, CHANGED_MIND, etc.)
- Reason text field: free-form description
- Optional: Initial photo upload (1–2 photos)
- "Start Return" button

**Flow:**
1. User selects order + line item
2. Fills reason + optional description
3. Clicks "Start Return"
4. Frontend calls `POST /api/returns/initiate`
5. On success, navigate to `/items/:itemId/evidence`

---

#### **Page 2: Sell-Used Initiation (`/secondhand/initiate`)**

**UI elements:**
- Two tabs:
  - **"I bought it here"** — same order picker as returns page
  - **"I bought it elsewhere"** — manual entry form (category, description, brand)
- Reason field: "Why are you selling?"
- "Start Listing" button

**Flow:**
1. User picks order (tab 1) or fills manual form (tab 2)
2. Fills reason
3. Clicks "Start Listing"
4. Frontend calls `POST /api/secondhand/initiate`
5. On success, navigate to `/items/:itemId/evidence`

---

#### **Page 3: Evidence Collection (`/items/:itemId/evidence`)**

**UI elements:**
- **Main content area (left 70%):**
  - Header: "Upload Evidence" + item summary (product name, thumbnail)
  - Trust tier badge: "Your Trust Tier: STANDARD" (with tooltip explaining what it means)
  - Loading state: "Generating customized form..." (shows while Pass 1 runs)
  - Dynamic form fields (rendered from Pass 1 schema):
    - Photo upload fields with S3 pre-signed URL flow:
      1. Frontend requests pre-signed URL from backend: `POST /api/s3/presigned-url`
      2. Backend generates pre-signed URL, returns it
      3. Frontend uploads directly to S3 using the pre-signed URL
      4. Frontend displays thumbnail + validation feedback (blur check, subject match via FastAPI)
    - Text input fields
    - Dropdowns (if Pass 1 specifies them)
  - Real-time validation feedback: "✓ Photo is clear" / "✗ Photo too blurry — retake"
  - "Submit Evidence" button (disabled until required fields filled)

- **Developer Logs Sidebar (right 30%):**
  - Collapsible sidebar showing real-time logs
  - Auto-scrolls to latest log
  - Color-coded by log type (success, info, error, warning)

**Flow:**
1. On mount, call `POST /api/grading/start` (triggers Pass 1)
   - Log: "📝 PASS1 START — Generating customized evidence form..."
2. Show generic loading state
3. When Pass 1 returns, render the schema-driven form
   - Log: "✅ PASS1 COMPLETE — Evidence form generated with 5 fields"
4. User uploads photos (S3 direct upload + real-time validation via FastAPI `/validate-photo` endpoint)
   - Log: "📸 PHOTO UPLOAD — Uploading photo 1 of 3..."
   - Log: "✓ Photo validation passed — Clear and well-lit"
5. User fills text fields
6. Clicks "Submit Evidence"
   - Log: "📤 EVIDENCE SUBMIT — Evidence submitted: 5 fields, 3 photos"
7. Frontend calls `POST /api/grading/submit` (triggers Pass 2)
   - Log: "⚙️ PASS2 START — Starting AI grading analysis..."
   - Log: "🛡️ FRAUD CHECK — Running fraud checks..."
   - Log: "🔬 ANALYSIS PARALLEL — Running OpenCV, CLIP, Rekognition..."
8. Show "Grading in progress..." spinner (Pass 2 takes 10–20s)
9. Logs continue updating in real-time from backend
10. On success, navigate to `/items/:itemId/status`

**Error handling:**
- Bedrock timeout → show cached form or text-only fallback
- S3 upload failure → retry logic with user-visible error
- Photo validation failure → inline feedback with retry CTA

---

#### **Page 4: Status & Results (`/items/:itemId/status`)**

**UI elements:**
- **Main content area (left 70%):**
  - Header: "Return Status" or "Listing Status"
  - Progress breadcrumbs: `INITIATED → EVIDENCE_PENDING → GRADED → ROUTED → ...`
  - Trust tier badge (same as evidence page)
  - Item summary card (product name, photo, intake path)
  - **If status = GRADED:**
    - Grade badge (A / B / C / D) with color coding
    - Quality score: "78/100"
    - Defects list (if any)
    - Return claim verification: "✓ Claim verified" or "⚠ Claim could not be verified"
    - Rationale (expandable): shows the full AI-generated explanation
    - Placeholder card: "Routing decision will appear here" (populated in P4)
  - **If status < GRADED:**
    - Current status message: "Grading in progress..."
    - Estimated time: "Results in ~15 seconds"
    - Auto-refresh every 3 seconds (polling `/api/items/:itemId/status`)

- **Developer Logs Sidebar (right 30%):**
  - Same collapsible sidebar as evidence page
  - Shows the full log history from initiation to current state
  - Continues to update in real-time if grading is in progress

**Trust tier conditional messaging:**
- **VERIFIED:** "Your return is fast-tracked. Refund will be issued shortly."
- **TRUSTED:** "Your return is being processed."
- **STANDARD:** "Your return is under review."
- **WATCH:** "Additional verification required. Refund will be issued after grading completes."
- **RESTRICTED:** "This return requires manual inspection."

**Logs visible on this page:**
- Full log history from initiation (user can see the complete journey)
- Real-time updates if status < GRADED
- Final logs show "✨ FLOW COMPLETE — Grading complete. Ready for routing."

---

### 3. Error Handling & Resilience

#### **Backend (Express):**
- Wrap all FastAPI calls in try-catch with timeout (30s)
- Log every error to the item's log stream:
  ```js
  await ItemLogger.log(itemId, 'ERROR', `❌ Bedrock timeout: ${error.message}`);
  ```
- If FastAPI is down:
  - Pass 1: return a cached generic schema based on category
  - Pass 2: return a grade with `confidence: "LOW"` and flag for human review
  - Log: "⚠️ WARNING — FastAPI unavailable, using fallback"
- Log all errors to CloudWatch / console with context (itemId, userId, endpoint)

#### **Frontend:**
- Error boundaries on each page
- Retry buttons on transient failures
- Loading states for all async operations
- Graceful degradation: if Pass 1 fails, show a generic form

#### **FastAPI:**
- All Bedrock calls have 25s timeout
- If Bedrock times out, return cached Pass 1 schema or a text-only Pass 2 grade
- All AWS service calls (Rekognition, Textract, S3) have retry logic (3 attempts)

---

### 4. Developer Experience Setup

#### **One-command dev server:**

Create `package.json` scripts (in the root):
```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:backend\" \"npm run dev:frontend\" \"npm run dev:ml\"",
    "dev:backend": "cd backend && npm run dev",
    "dev:frontend": "cd frontend && npm run dev",
    "dev:ml": "cd ml-service && uvicorn main:app --reload --port 8000",
    "seed": "cd backend && node seed.js",
    "seed:reset": "cd backend && node seed.js --reset"
  }
}
```

Install `concurrently` in the root:
```bash
npm install --save-dev concurrently
```

**Now the team can run:**
```bash
npm run dev        # starts all three services
npm run seed       # seeds demo data
npm run seed:reset # drops DB and reseeds
```

---

#### **Environment variable consolidation:**

Create a root `.env.example`:
```
# MongoDB
MONGODB_URI=mongodb+srv://...

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=marketplace-evidence-photos
KMS_KEY_ID=...

# Bedrock
BEDROCK_MODEL_ID=amazon.nova-pro-v1:0
BEDROCK_FALLBACK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0

# Services
FASTAPI_URL=http://localhost:8000
BACKEND_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173

# Session
JWT_SECRET=...
```

Both `backend/.env` and `ml-service/.env` can source from this (or use dotenv-cli).

---

#### **CORS configuration (Express):**

In `backend/server.js`:
```js
const cors = require('cors');

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
```

---

#### **Postman / Thunder Client collection:**

Export a collection with these requests:
- `POST /api/returns/initiate`
- `POST /api/secondhand/initiate`
- `POST /api/grading/start`
- `POST /api/grading/submit`
- `GET /api/items/:itemId/status`
- `POST /api/s3/presigned-url`

Commit it to `./docs/api-collection.json` so anyone can test the endpoints without the UI.

---

### 5. Integration Testing Checklist

Before declaring P3.5 done, manually verify:

- [ ] **Returns flow works end-to-end:**
  - Initiate return via UI
  - Trust tier displays correctly
  - **Developer logs sidebar shows each step in real-time**
  - Pass 1 form schema appears
  - Upload 3 photos to S3 (check S3 bucket)
  - **Logs show "📸 PHOTO UPLOAD" and "✓ Photo validation passed"**
  - Real-time photo validation works (blur detection, CLIP match)
  - Submit evidence
  - **Logs show "⚙️ PASS2 START", "🛡️ FRAUD CHECK", "🔬 ANALYSIS PARALLEL"**
  - Pass 2 grade appears on status page within 20s
  - **Logs show "🎯 GRADE ASSIGNED" with grade details**
  - Grade persists in MongoDB (check `grades` collection)
  - Item status updates to `GRADED`
  - Lifecycle events logged correctly
  - **Final log: "✨ FLOW COMPLETE — Grading complete. Ready for routing."**

- [ ] **Sell-Used flow (bought here) works end-to-end:**
  - Initiate listing via UI (order picker)
  - **Logs show full flow from INITIATE to FLOW_COMPLETE**
  - Full flow same as above

- [ ] **Sell-Used flow (bought elsewhere) works end-to-end:**
  - Initiate listing via UI (manual entry)
  - **Logs show full flow**
  - Full flow same as above

- [ ] **Developer logs functionality:**
  - Logs appear in real-time (2-second polling works)
  - Logs persist across page refreshes
  - Logs show correct timestamps
  - Log icons and colors display correctly
  - Sidebar is collapsible (toggle button works)
  - Auto-scroll to latest log works
  - No duplicate logs appear
  - Error logs display with ❌ icon and red color

- [ ] **Trust tier gating works:**
  - Seed users with different trust tiers (VERIFIED, TRUSTED, STANDARD, WATCH)
  - Initiate returns with each user
  - **Logs show "✅ TRUST COMPLETE — Trust tier: X" for each user**
  - Verify different messaging appears
  - (Optional: verify different form fields for WATCH tier — can defer to P4)

- [ ] **Error scenarios handled:**
  - FastAPI down → graceful fallback + **log shows "⚠️ WARNING — FastAPI unavailable"**
  - Bedrock timeout → cached schema / low-confidence grade + **log shows "❌ ERROR — Bedrock timeout"**
  - S3 upload failure → retry button appears + **log shows upload failure**
  - Invalid item ID → 404 error page

- [ ] **Dev experience works:**
  - `npm run dev` starts all services
  - `npm run seed` populates demo data
  - `npm run seed:reset` resets cleanly
  - No CORS errors in browser console
  - All endpoints respond within expected times
  - **Logs sidebar appears on all return/secondhand pages**

---

### 6. Data Model Verification

Ensure these MongoDB collections exist and have the right shape:

#### **`itemLogs` collection (NEW):**
```js
{
  _id: ObjectId,
  itemId: ObjectId (indexed),
  step: String,  // e.g., "INITIATE", "TRUST_COMPUTE", "PASS1_START"
  message: String,  // Plain English message
  metadata: Object,  // Optional structured data
  timestamp: Date (indexed, TTL: 7 days)
}
```

#### **`items` collection:**
```js
{
  _id: ObjectId,
  userId: ObjectId,
  orderId: ObjectId (nullable),
  productId: ObjectId,
  intakePath: "RETURN" | "SELL_USED",
  status: "INITIATED" | "EVIDENCE_PENDING" | "GRADING" | "GRADED" | "ROUTED" | ...,
  reason: String,
  reasonCategory: String,
  images: [String],  // S3 URLs
  trustProfileId: ObjectId,
  gradeId: ObjectId (nullable),
  routingDecisionId: ObjectId (nullable),
  createdAt: Date,
  updatedAt: Date
}
```

#### **`trustProfiles` collection:**
```js
{
  _id: ObjectId,
  userId: ObjectId,
  tier: "VERIFIED" | "TRUSTED" | "STANDARD" | "WATCH" | "RESTRICTED",
  lifetimePurchases: Number,
  lifetimeReturns: Number,
  returnRate: Number,
  recent90DayReturns: Number,
  accountAge: Number,
  signals: [
    { type: String, severity: String, description: String }
  ],
  computedAt: Date
}
```

#### **`grades` collection:**
```js
{
  _id: ObjectId,
  itemId: ObjectId,
  grade: "A" | "B" | "C" | "D",
  qualityScore: Number,
  defects: [String],
  missingEvidence: [String],
  returnClaimVerified: Boolean,
  estimatedResalePct: Number,
  routingHint: "RESELL" | "REFURBISH" | "DONATE" | "LIQUIDATE",
  rationale: String,
  confidence: "HIGH" | "MEDIUM" | "LOW",
  evidenceBundle: {
    pass1Schema: Object,
    photos: [String],
    analysisResults: Object,
    modelVersions: Object
  },
  createdAt: Date
}
```

#### **`lifecycleEvents` collection:**
```js
{
  _id: ObjectId,
  itemId: ObjectId,
  event: "INITIATED" | "EVIDENCE_PENDING" | "GRADED" | "ROUTED" | ...,
  timestamp: Date,
  metadata: Object,
  prevEventHash: String (nullable)  // for hash chain in P5
}
```

---

### 7. Common Integration Issues & Fixes

| Issue | Symptom | Fix |
|---|---|---|
| **Schema mismatch** | Backend expects `userId`, FastAPI sends `user_id` | Standardize on camelCase everywhere (update P2's FastAPI responses) |
| **Missing trust profile** | Grade fails because `trustTier` is undefined | Ensure `/initiate` endpoints always compute trust profile before returning |
| **S3 upload fails** | CORS error or 403 on pre-signed URL | Fix S3 bucket CORS policy + IAM policy for pre-signed URLs |
| **Pass 1 never returns** | Frontend stuck on "Generating form..." | Add 30s timeout + fallback to cached schema |
| **Pass 2 takes too long** | User waits 60s for grade | Verify Bedrock region is correct (us-east-1), check Bedrock quota |
| **Photos not displaying** | Broken image in status page | Ensure S3 URLs are publicly readable or use pre-signed URLs for display |
| **Trust tier not visible** | Badge missing on evidence page | Check that `/api/items/:itemId/status` includes `trustTier` in response |

---

## Team Collaboration During P3.5

### Recommended split (3 people):

| Person | Owns | Time |
|---|---|---|
| **Frontend (Person C)** | All 4 React pages, S3 upload flow, **Developer Logs Sidebar component**, error boundaries, loading states | ~2 hours |
| **Backend (Person B)** | Orchestration endpoints, trust profile integration, lifecycle events, **ItemLogger utility + logs endpoint** | ~1.5 hours |
| **AI/Python (Person A)** | FastAPI integration fixes, error handling in Pass 1/Pass 2, photo validation endpoint | ~1 hour |

**Then everyone tests together:** ~30 minutes end-to-end smoke testing.

---

### Recommended split (2 people):

| Person | Owns | Time |
|---|---|---|
| **Full-stack JS (Person B)** | All React pages + orchestration endpoints + trust integration + **ItemLogger + logs sidebar** | ~2.5 hours |
| **AI/Python (Person A)** | FastAPI fixes + error handling + test grading flow with Postman | ~1 hour |

**Then both test together:** ~30 minutes.

---

## Output Artifacts

At the end of P3.5, commit:
- ✅ **4 new Express endpoints** (`/returns/initiate`, `/secondhand/initiate`, `/grading/start`, `/grading/submit`)
- ✅ **NEW: Logs endpoint** (`GET /api/items/:itemId/logs`)
- ✅ **NEW: ItemLogger utility** (`backend/src/utils/itemLogger.js`)
- ✅ **NEW: ItemLog model** (`backend/src/models/itemLog.model.js`)
- ✅ **4 React pages** (returns initiate, sell-used initiate, evidence collection, status)
- ✅ **NEW: DeveloperLogsSidebar component** (collapsible sidebar with real-time logs)
- ✅ **S3 pre-signed URL endpoint** (`/api/s3/presigned-url`)
- ✅ **Updated seed script** (includes users with varied trust histories)
- ✅ **Dev scripts** (`npm run dev`, `npm run seed`)
- ✅ **API collection** (Postman/Thunder Client JSON)
- ✅ **README section** ("How to Test the Flow")
- ✅ **Log emission at every major step** (20+ log points across the flow)

---

## Next Phase: P4 (Routing)

Once P3.5 is done and tested, **P4 can start immediately** because:
- Grade JSON is flowing reliably
- Trust profiles are attached to every item
- Intake path is captured
- The status page has a placeholder for routing results

P4 will consume these outputs and add:
- Reverse-logistics cost calculator
- Weighted scoring engine
- Routing decision UI (horizontal bars)
- Routing decision persistence

The frontend already has the slot for it (`routingDecision: null` on the status page) — P4 just fills it in.

---

## Troubleshooting Tips

### "FastAPI not responding"
- Check `ml-service/.env` has correct AWS credentials
- Verify Bedrock model access was approved (check AWS console)
- Check FastAPI logs: `cd ml-service && tail -f logs/app.log`

### "Grade takes 60+ seconds"
- Bedrock throttling — reduce batch size or add retry backoff
- Cold-start issue — first request always slower, accept it for demo

### "Photos not uploading"
- Check S3 bucket policy allows `PutObject` from your IP
- Check pre-signed URL expiry (default 15 min)
- Check CORS policy on S3 bucket

### "Trust tier always shows STANDARD"
- Verify seed data has users with purchase/return history
- Check trust service logic computes tier correctly
- Add debug logging in `trustService.computeTrustProfile()`
- **Check logs sidebar** — should show "✅ TRUST COMPLETE — Trust tier: X"

### "Logs not appearing in sidebar"
- Check MongoDB `itemLogs` collection exists and has data
- Verify `/api/items/:itemId/logs` endpoint returns logs
- Check frontend polling is working (Network tab, every 2s)
- Check CORS allows the logs endpoint
- Verify itemId matches between route param and API call

### "Logs sidebar shows duplicate entries"
- Check polling interval isn't creating duplicate fetch calls
- Verify log deduplication in MongoDB (shouldn't happen with timestamps)
- Clear browser cache and reload

### "Auto-scroll not working"
- Check `logsEndRef.current` is defined
- Verify `scrollIntoView` is supported in the browser
- Try using `smooth` vs `auto` behavior

---

**End of Phase 3.5.**

Once this phase is complete, you have a **demoable artifact** — a working 
intake-to-grade flow that judges/stakeholders can see, even before routing exists.
