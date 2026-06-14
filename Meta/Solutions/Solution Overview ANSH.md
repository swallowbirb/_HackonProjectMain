# Second-Life Commerce Platform — Solution Overview

> A consolidated bird's-eye view of the whole system. Particulars per subsystem will be specced out separately as we drill in.

---

## 1. Problem We're Solving

Amazon (and e-commerce broadly) loses massive value on returned items, and customers have no trustworthy on-platform way to resell their old goods, because:
- Reverse logistics often costs more than the returned item itself (e.g., ₹500 shoes, ₹100 to ship back)
- Returned items are graded inconsistently or sent straight to liquidation regardless of actual condition
- No mechanism to match a returned (or user-listed used) item with nearby demand — items travel long distances unnecessarily
- Customers wanting to sell their used goods have to leave Amazon and use OLX/Quikr/Cashify, fragmenting trust and value
- No persistent "trust artifact" that lets a second buyer verify the item's real condition
- Sustainability impact of churn is invisible

**Our pitch:** an AI-driven dual-intake (Returns + Sell-Used) pipeline that grades every item the same way, routes it to the cheapest economically-viable destination, and lists resellable items on a single platform-mediated second-hand marketplace.

---

## 2. End-to-End Flow (At a Glance)

```
[Customer initiates return]
         │
         ▼
[AI Returns Grading]   ── 2-pass MLLM pipeline
   • Pass 1: generate evidence-request form tailored to product + reason
   • Pass 2: grade submitted photos → Grade A/B/C/D + JSON contract
         │
         ▼
[Smart Routing & Disposition Engine]
   Decides where the item should go based on:
     • Grade & estimated resale %
     • Nearby demand (geospatial query)
     • Reverse-logistics cost vs. item value
     • Seller / lister return policy
     • Intake path (returns vs. sell-used — affects which branches are available)
                            │
                            ▼
   ┌─────────────────────────────────────────────────────────┐
   │ Decision branches:                                       │
   │                                                          │
   │  Grade A/B + nearby demand → ship to nearest warehouse  │
   │                              with demand → list on       │
   │                              Resale Marketplace          │
   │                                                          │
   │  Grade A/B + no nearby demand:                           │
   │    • Returns path → check seller-return feasibility      │
   │       • feasible → return to seller                      │
   │       • not feasible → liquidate / donate                │
   │    • Sell-used path → list anyway (wider radius) or      │
   │                        notify lister of low-demand       │
   │                                                          │
   │  Grade C → liquidation lane (discount resale or bulk)   │
   │                                                          │
   │  Grade D → recycle / parts harvest / donation           │
   └─────────────────────────────────────────────────────────┘
         │
         ▼
[Action Handoff Layer]
   • Generate pickup task (Amazon locker / scheduled pickup)
   • Auto-generate marketplace listing (title, description, photos)
   • Issue Product Health Card (signed QR + grade record)
   • Update sustainability counter (CO2 / water saved)
         │
         ▼
[Resale Marketplace Page]
   • Hosts BOTH returned items (Grade A/B from returns flow)
     AND user-listed second-hand items (sell-used flow)
   • All items carry verified AI grade + Product Health Card
   • Platform-mediated (no direct buyer-seller contact)
   • Lower-graded items shown in a discounted "Fair Condition" lane
   • Fulfilled from the warehouse the item was routed to
```

---

## 2b. Two Intake Paths — Side by Side

| Aspect | Returns Path | Sell-Used Path |
|---|---|---|
| **Trigger** | Customer initiates return on recent order | Customer voluntarily lists an old item |
| **Entry point** | Return URL from order page | "Sell on Amazon Second-Hand" page |
| **Listing data source** | Original order + product catalog | Customer picks product from catalog or describes it |
| **Grading flow** | Same 2-pass MLLM pipeline | Same 2-pass MLLM pipeline |
| **Routing options** | Resell, return-to-seller, liquidate, donate | Resell, hold-for-wider-demand, donate |
| **Payout** | Refund (per return policy) | Resale proceeds minus platform fee |
| **Result** | Both end up on the **Resale Marketplace page** if Grade A/B/C |

---

## 3. Core Subsystems

### 3.1 AI Grading (already specced)
- **Used by both intake paths** — returns flow and sell-used flow share the same pipeline
- Outputs a versioned Grade JSON: grade, quality_score, confidence, defects, estimated_resale_pct, routing_hint
- Status: requirements complete, design + tasks pending

#### How the Grading Pipeline Works (Hybrid Approach)

Rather than sending raw photos to one expensive LLM, we use a **hybrid pipeline** where specialized cheap/fast tools run first and the LLM only synthesizes the final grade from their structured output.

```
[Fraud Check — before any processing]
  • imagehash (perceptual hash) — detects copied catalog/stock photos
  • Pillow/EXIF — checks for camera metadata (real photos have it; stock images don't)
  • AWS Rekognition — web reverse image match
  → If flagged: reject early, save all downstream cost
         │
         ▼
[Bedrock Pass 1 — Form Generator]
  Model: Amazon Nova Pro (multimodal) on Bedrock
  Input: return reason + initial images + listing data + category prompt
  Output: JSON form schema → dynamically rendered React form
  Cached by hash(product_id + reason) — same product+reason reuses schema

         │  User fills form, uploads photos
         ▼

[Per-photo real-time validation as user uploads]
  • OpenCV — blur + lighting check
  • CLIP   — subject match ("does this show a collar?")
  → Instant inline feedback before submission

         │  User submits completed form
         ▼

[Specialized Analysis — runs in parallel, all fast/cheap]
  • OpenCV          — color extraction + histogram vs listing photo
  • CLIP            — overall visual similarity score vs listing
  • AWS Rekognition — defect/damage label detection (no training needed)
  • AWS Textract    — reads serial numbers, labels, tags from photos
  All outputs assembled into one structured JSON summary

         │
         ▼

[Bedrock Pass 2 — Grade Synthesizer]
  Model: Amazon Nova Pro or Claude 3.5 Sonnet on Bedrock
  Input: structured JSON summary (NOT raw images — cheap text call)
  Output: final Grade JSON (grade A/B/C/D, quality_score, defects, routing_hint, rationale)
```

**Why hybrid?** Sending raw images to the LLM on every call is expensive and slow. Specialized tools (OpenCV, CLIP, Rekognition, Textract) are faster, free/near-free, and better at their specific jobs. The LLM only sees a compact structured summary and reasons over it — making Pass 2 cheap enough to run on every return.

**Key tools:**

| Tool | Job | Cost |
|---|---|---|
| OpenCV | Blur, lighting, color | Free |
| CLIP (Hugging Face, local) | Subject verify, visual similarity | Free |
| AWS Rekognition | General defect detection | Free tier |
| AWS Textract | OCR — labels, serial numbers | Free tier |
| imagehash + Pillow | Fraud / stock photo detection | Free |
| Amazon Bedrock (Nova Pro) | Pass 1 form gen + Pass 2 grade synthesis | ~$0 at hackathon scale |
| AWS S3 | Image storage | Free tier |

### 3.2 Smart Routing & Disposition Engine
- Consumes the Grade JSON and decides the destination
- Rule-based weighted scoring across candidate paths (transparent, debuggable, demo-friendly)
- Inputs: grade, item value, reverse-logistics cost, nearby demand count, seller policy, **intake_path** (returns vs. sell-used — gates which branches are available)
- Output: chosen path + ranked alternatives + human-readable rationale
- Render the decision live as horizontal bars showing each path's net recovery — strongest single demo moment

### 3.3 Demand Registry (Geospatial Matching)
- A `wants` collection: `{user_id, category/sku, geo_point, notify_on_match}`
- MongoDB `2dsphere` index + `$geoNear` aggregation for "nearest demand" queries
- Routing engine queries: "starting from the customer's location, where is the closest cluster of demand for this product?"
- Powers the "ship to the warehouse closest to where buyers actually are" decision

### 3.4 Resale Marketplace Page
- Single platform-mediated storefront hosting **both**:
  - Items from the **Returns flow** (customers returned them, graded A/B/C, routed here for resale)
  - Items from the **Sell-Used flow** (customers voluntarily listed their old goods)
- Every item carries the same AI grade badge, condition rationale, photos, and Product Health Card — buyer can't tell (or care) which intake path the item came from
- No direct buyer-seller contact (safety + trust)
- Fulfilled like a normal Amazon order from the routed warehouse
- Lower-graded items grouped in a discounted "Fair Condition" lane

### 3.5 Reverse-Logistics Cost Calculator
- Small utility: `cost = f(distance, weight, carrier_rate)`
- Used by routing engine to detect "shoes cheaper than the box" cases
- Triggers donation/local-redistribution path when ship-back cost > item value

### 3.6 Product Health Card (Trust Layer)
- Every routed item gets a QR code linked to its signed condition record
- Cryptographic signature (Ed25519) over canonical grade JSON — tamper-evident without blockchain
- Hash-chained event history (grading → repair → resale) for provenance
- Frames as "EU Digital Product Passport (DPP) ready" — credible forward-looking USP

### 3.7 Sustainability Counter
- Per disposition, compute CO2 + water saved using category factors (e.g., 25 kg CO2 per kg clothing reused)
- Running counter on dashboard; per-item green credits awarded to customers
- Strong narrative lever, trivial to compute

### 3.8 Pickup / Drop-off Strategy *(open question — see §5)*
- Options on the table: customer-holds-until-sold, scheduled batch pickup, Amazon locker drop-off
- Each has different cost / UX / trust trade-offs
- Decide later, doesn't block other subsystems

---

## 4. Key Decisions Locked In

| Decision | Choice | Why |
|---|---|---|
| Direct buyer-seller contact | **No** — platform-mediated only | Safety, trust, consistent UX |
| Demand search direction | **Customer-location outward** | Minimize shipping distance first |
| Disposition priority | Resell-via-marketplace → return-to-seller (if feasible) → liquidate / donate | Maximizes recovery, minimizes waste |
| Routing engine type | **Rule-based weighted scoring**, not ML | Transparent, debuggable, demo-friendly |
| Trust mechanism | **Cryptographic signatures + QR**, not blockchain | Same demo value, zero infra cost |
| Grading approach | **Multimodal LLM API**, not custom CV models | Works day one, no training data needed |
| Stack | **MERN** + optional Python FastAPI for ML model | Free-tier friendly, MongoDB does double duty (vector + geo) |

---

## 5. Open Questions (To Decide Later)

These don't block progress on individual subsystems but need answers before final integration:

1. **Pickup / drop-off model** — customer-holds, batch pickup, or Amazon locker drop-off?
2. **Speculative vs. on-demand warehouse transfer** — list first then move on sale, or move immediately to nearest demand-warehouse?
3. **Seller return-policy schema** — what fields does each seller configure? (accept_threshold, allow_donation, refurbish_partner_id, etc.)
4. **Pricing model for resale items** — fixed % of new price by grade? AI-suggested with seller override? Demand-multiplier?
5. **Hygiene-sensitive categories** — already short-circuited in grading spec; need to confirm liquidation-only path in routing
6. **Refurbishment partner integration** — in scope for hackathon or later phase?
7. **Locker / pickup logistics** — mock for demo or wire a real service?

---

## 6. Tech Stack at a Glance (AWS-Native)

Since this is an **Amazon HackOn**, the stack leans AWS-native end to end.

| Layer                      | Technology                                                                                                                   | Notes                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ML microservice (optional) | **AWS Lambda (container image)** or **Amazon SageMaker endpoint**                                                            | For XGBoost return model, optional CV models                                                                          |
| Vision LLM                 | **Amazon Prekognition + Bedrock** — Amazon Nova Pro (multimodal, primary) / Claude 3.5 Sonnet (fallback)                     | Pass 1 form gen + Pass 2 grade synthesis; Nova Pro preferred for judge appeal                                         |
| CV / ML tools              | **OpenCV** (blur, color), **CLIP** (subject verify, similarity), **AWS Rekognition** (defect labels), **AWS Textract** (OCR) | Run in parallel in a Python FastAPI microservice before Pass 2                                                        |
| Database                   | **Amazon DynamoDB**                                                                                                          | Primary data store — grades, items, users, routing events, demand registry; single-digit ms latency, fully serverless |
| Geospatial                 | **Amazon Location Service** + **geohash pattern in DynamoDB**                                                                | Location Service for distance/routing calcs; geohash-prefixed partition keys for proximity queries in DynamoDB        |
| Vector / similarity        | **Amazon OpenSearch Serverless** (k-NN)                                                                                      | CLIP image embeddings + text search for resale listing discovery                                                      |
| Image storage              | **Amazon S3**                                                                                                                | Pre-signed URLs for direct upload from browser                                                                        |
| Image processing           | **AWS Lambda + Sharp** (Node)                                                                                                | Compression, blur detection, EXIF                                                                                     |
| Cache                      | **Amazon DynamoDB DAX**                                                                                                      | In-memory cache layer for DynamoDB — Pass 1 form schemas, hot routing configs                                         |
| WhatsApp (optional)        | **Amazon End User Messaging Social** or Twilio sandbox                                                                       | SMS/WhatsApp seller bot                                                                                               |
| Logs / monitoring          | **Amazon CloudWatch**                                                                                                        | Metrics, alarms, log aggregation                                                                                      |
| Secrets                    | **AWS Secrets Manager**                                                                                                      | API keys, signing keys                                                                                                |
| Analytics dashboard        | **Amazon QuickSight**                                                                                                        | Seller dashboard, sustainability counter                                                                              |
| QR / signing               | `qrcode` + Node `crypto` (Ed25519); signing keys in **KMS**                                                                  | Tamper-evident Product Health Card                                                                                    |

Most services are within **AWS Free Tier** for hackathon scale. Bedrock charges per-token (Nova Pro is the cheapest multimodal option in Bedrock).

---

## 8. Demo Storyline (Four Personas — covering both intake paths)

### Returns Path

**Priya (₹500 shoes, worn) — Returns**
1. Initiates return → AI grades "C" (worn soles, functional)
2. Routing engine shows: ship-back-to-seller would cost ₹120 (24% of item value) → uneconomical
3. Engine routes to local donation lane → NGO match + tax receipt PDF
4. Sustainability counter ticks up: "1.2 kg CO2 saved by reuse"

**Rahul (used baby monitor) — Returns**
1. Initiates return → AI grades "B" (good, minor cosmetic wear)
2. Routing engine queries demand registry: "50 parents within 5 km want this category"
3. Routes to nearest warehouse serving that demand cluster → auto-listed on Resale Marketplace
4. AI generates listing copy from grading photos
5. Product Health Card issued with QR + verified condition

**Small Seller (200 returns/month) — Returns at scale**
1. Bulk dashboard: every return auto-graded, auto-routed, auto-priced
2. Recovery value summary across the batch
3. Seller policy config drives routing decisions
4. B2B API angle — frame as a platform, not just an app

### Sell-Used Path

**Anjali (selling old DSLR camera) — Sell-Used**
1. Opens "Sell on Amazon Second-Hand" → picks her camera model from catalog
2. Same 2-pass grading flow → AI grades "A" (lightly used, all accessories)
3. Routing engine: high demand for this model in her city → routes to nearest warehouse with demand
4. AI generates polished resale listing (title, description, suggested price ₹X based on grade + market data)
5. Anjali drops the item at an Amazon locker; gets paid on sale (resale proceeds minus platform fee)
6. Buyer sees AI grade + Product Health Card → buys with same confidence as a normal Amazon purchase

---

## 9. What's Next

The natural next step is to spec out subsystems individually as we lock in details:
- Smart Routing & Disposition (core decision engine)
- Demand Registry & Geospatial Matching
- Resale Marketplace + Listing Generation
- Product Health Card
- Sustainability Accounting

The grading spec is already in place. We pick one of the above to drill into next when ready.

---

**Doc version:** 0.1 (overview-only, particulars TBD)
**Last updated:** June 13, 2026
