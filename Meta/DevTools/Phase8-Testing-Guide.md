# Phase 8 Testing Guide — Frontend Walkthrough

## 🎯 What You're Testing

Phase 8 adds these new features:
1. **Auto-routing after grading** — item automatically gets routed when grading completes
2. **Seller Returns Dashboard** — seller sees all their returns with live shipment tracking
3. **Shipment tracking** — shows pickup → transit → arrival → listed
4. **Peer offers** — nearby buyers can claim items for local handoff
5. **Warehouse demand** — routing picks the warehouse where the item will sell fastest

---

## 📱 Your Test Scenario

**Setup:**
- **Seller account:** "Dev Store" — has listed an Oppo Reno 11 phone
- **Buyer account:** You bought the phone and now want to return it
- **Admin account:** `mock_admin` — needed to advance order status (testing only)
- **Physical item:** You have an Oppo phone to photograph

**Goal:** Test the complete return journey from buyer initiating return → AI grading → routing decision → seller sees tracking → final listing

**Note:** You'll need to switch between three accounts during testing:
1. **Admin** (`mock_admin`) — to advance the order to "Dispatched" status
2. **Buyer** — to initiate and complete the return
3. **Seller** (Dev Store) — to view the Returns dashboard and track shipment

---

## 🧪 Step-by-Step Testing Instructions

### **Step 0: Prepare the Order (Admin)**

Since the "Advance shipping" button is now admin-only, you need to prepare the order first.

1. **Log in as admin** (`mock_admin` account)
2. Go to **"Returns & Orders"** page
3. Find the Oppo Reno 11 order (should show "Order placed")
4. Click **"Advance shipping"** button 1-2 times until it shows **"Dispatched"** or **"Delivered"**
5. **Log out** from admin account

**Expected result:** Order is now ready to be returned

---

### **Step 1: Start the Return (Buyer Side)**

1. **Log in as the buyer** who purchased the Oppo phone
2. Go to **"Returns & Orders"** page
3. Find the Oppo Reno 11 order (should show "Dispatched" or "Delivered")
4. Click **"Return Item"** button

**Expected result:** Return modal opens asking for reason

---

### **Step 2: Choose Return Reason**

1. Select a reason (e.g., "Defective" or "Not as described")
2. Optionally add text explaining the issue
3. Click **"Continue"** or **"Submit"**

**Expected result:** 
- Modal closes
- System creates the return item
- You're redirected to the **Evidence Upload** page

---

### **Step 3: Upload Evidence Photos (AI Grading)**

This is where Phase 2 (AI Grading) happens. The AI generates a custom form for the Oppo phone.

1. You'll see multiple **evidence fields** (e.g., "Front view", "Back view", "Screen", etc.)
2. **For each field:**
   - Click "Upload photo"
   - Take/select a photo of your actual Oppo phone
   - Wait for the AI to validate it (green checkmark = good, red = needs fixing)
3. After uploading photos for a field, click **"Verify Field"**
4. Once all fields are verified, click **"Submit for Grading"**

**Expected result:**
- AI grades the phone (A/B/C/D)
- Shows quality score, defects, estimated value
- Shows the grading reasoning

---

### **Step 4: Check Auto-Routing (NEW in Phase 8)**

After grading completes, **routing happens automatically** now.

**Expected result:**
- The item status should change to **"ROUTED"**
- You should see a routing decision on the page showing:
  - Path chosen (e.g., "RESELL" or "PEER")
  - Which warehouse it's going to (or if it's a peer offer)
  - Estimated recovery value

**Where to check:**
- Stay on the item detail page after grading
- Or go to **"Returns & Orders" → "Returns & Listings" tab**
- Find your item and click on it

---

### **Step 5: View Seller Returns Dashboard (Seller Side)**

Now **switch to the seller account** (Dev Store).

1. **Log in as the seller** (the one who originally sold the phone)
2. Go to **"Seller Dashboard"**
3. Click the **"Returns"** tab (NEW in Phase 8)

**Expected result:**
- You see a card for the Oppo phone return
- Shows:
  - Item photo and title
  - Current status: **"Preparing for pickup"** (0%)
  - Destination warehouse (e.g., "Raipur Central Hub")
  - Estimated earnings (e.g., "₹6,992")
  - A **"Mark as Picked Up"** button

---

### **Step 6: Mark Pickup (Seller Simulates Courier Collection)**

1. Click the **"Mark as Picked Up"** button

**Expected result:**
- Status updates to **"In Transit"** (33%)
- Progress bar shows 33%
- Button disappears
- Shows estimated arrival date

**Behind the scenes:** This triggers the shipment tracking logic. The system calculates:
- Transit time based on warehouse distance
- Running shipping costs
- Expected arrival date

---

### **Step 7: Watch Shipment Progress (Auto-Updates)**

The Returns dashboard **auto-refreshes every 3.5 seconds**.

**What happens over time:**
- Status progresses: "In Transit" → "Arrived" → "Listed for Sale"
- Progress bar increases: 33% → 66% → 100%
- Costs update as the shipment progresses

**Note:** In the real system, this would take days. For testing, you can either:
- **Wait** for the estimated time to pass (system uses real timestamps)
- **Manually advance** by calling the backend endpoint (see "Advanced Testing" below)

**Expected final result:**
- Status: **"Listed for Sale"** (100%)
- The second-hand listing is now **public**
- Seller sees final earnings amount

---

### **Step 8: Verify the Second-Hand Listing (Buyer Side)**

1. **Switch back to buyer account** (or use a different browser)
2. Go to **"Second-Hand"** page (navigation menu)
3. Search for "Oppo" or browse listings

**Expected result:**
- You see the Oppo Reno 11 listed
- Shows the AI grade (A/B/C/D)
- Shows quality score
- Shows defects detected
- Shows the grading reasoning
- Shows seller notes (if any)
- Shows price (auto-calculated based on grade)

---

### **Step 9: Test Peer Offers (OPTIONAL — if routing chose PEER)**

If the routing engine found a nearby buyer who already wants this phone, it creates a **peer offer** instead of shipping to warehouse.

**Where to check:**
1. Go to **"Looking For"** page (in navigation)
2. Scroll to **"Available near you"** section

**Expected result:**
- You see a card: "Oppo Reno 11, Grade A, ₹X, Available near you"
- Shows distance to seller
- Shows **"Claim"** button
- Shows **48-hour claim window**

**To test claiming:**
1. Click **"Claim"** button
2. Expected: Item is reserved for you
3. You have 48 hours to meet the seller and complete purchase
4. If you don't complete, system **automatically falls back** to warehouse route

---

## 🔍 What "Advance Shipping" Button Does (Admin Only)

**Location:** Buyer's Orders page, on each order

**Purpose:** **Admin/testing only** — lets admins manually progress order fulfillment:
- placed → dispatched → in_transit → out_for_delivery → delivered

**Why it exists:** So during development/testing, admins can quickly simulate an order reaching "delivered" status without waiting for real shipping.

**Visibility:** 🔒 **Only visible to users with `role: 'admin'`**. Regular buyers will NOT see this button.

**For Phase 8 testing:** 
1. First log in as admin (`mock_admin`) 
2. Go to Orders page
3. Use "Advance shipping" to move the Oppo order to "Dispatched" or "Delivered"
4. Log out and log back in as buyer
5. Now you can test the return flow

---

## ✅ Expected Results Summary

| Step | What You Do | What You Should See |
|------|-------------|---------------------|
| 1 | Click "Return Item" | Return modal opens |
| 2 | Choose reason, submit | Redirected to evidence upload |
| 3 | Upload photos, verify fields | AI grades item, shows A/B/C/D + reasoning |
| 4 | Grading completes | **Auto-routing happens**, status → "ROUTED" |
| 5 | Seller opens Returns tab | Sees return card with "Preparing for pickup" |
| 6 | Seller clicks "Mark as Picked Up" | Status → "In Transit" (33%), button disappears |
| 7 | Wait or manually advance time | Status progresses → "Arrived" (66%) → "Listed" (100%) |
| 8 | Buyer browses Second-Hand | Sees the listing with AI grade and details |
| 9 (optional) | If peer route chosen | Buyer sees "Available near you" offer |

---

## 🐛 Troubleshooting

### **Problem:** Don't see "Returns" tab on Seller Dashboard
**Fix:** Make sure you're logged in as the **seller account** (the one who originally sold the item)

### **Problem:** Routing doesn't happen after grading
**Fix:** Check the browser console for errors. Routing should auto-trigger when status changes to "GRADED"

### **Problem:** Shipment status stuck at "Preparing for pickup"
**Fix:** Make sure you clicked "Mark as Picked Up" button on the seller side

### **Problem:** Status not progressing from "In Transit"
**Fix:** The system uses real timestamps. Check the estimated arrival date shown. Or use the advanced testing method below.

### **Problem:** Don't see the second-hand listing
**Fix:** The listing appears only after the shipment **arrives** at the warehouse. After marking "Picked Up":
- Wait **90 seconds** (default demo timeline)
- The status will auto-progress to "Arrived" (100%)
- The listing will **auto-publish** and appear on Second-Hand page
- OR manually advance: call `GET /api/routing/:itemId/shipment` a few times to trigger the check

### **Problem:** Listing shows but no images
**Fix:** Images now fall back to original product images if no evidence photos were uploaded. Restart the backend server to apply the fix.

---

## 🧑‍💻 Advanced Testing (Manual Time Progression)

If you want to **skip waiting** for the real timeline, you can manually advance the shipment:

**Using API directly:**
```bash
# Check current shipment state
GET http://localhost:5000/api/routing/:itemId/shipment

# The system auto-advances based on timestamps
# To test instantly, you can modify the pickup timestamp in the database
```

**Or modify test data:**
- Open MongoDB Compass
- Find the `routingdecisions` collection
- Find your item's routing decision
- Change `shipment.pickupAt` to an earlier date (e.g., 3 days ago)
- Refresh the seller Returns tab — status will update

---

## 📊 What Phase 8 Actually Tests

✅ **Auto-routing wiring** — grading → routing happens automatically  
✅ **Warehouse demand** — routing picks best warehouse based on local demand  
✅ **Shipment tracking** — derives status from pickup timestamp  
✅ **Seller dashboard** — live updates, progress bars, financials  
✅ **Peer offers** — nearby buyer claims, 48-hour window, fallback  
✅ **Auto-publish** — listing goes live when shipment arrives  

---

## 🎬 Quick Test Sequence (5 minutes)

1. Buyer: Return item → Upload photos → Get grade ✅
2. Check: Item status is "ROUTED" ✅
3. Seller: Open Returns tab → See return card ✅
4. Seller: Click "Mark as Picked Up" ✅
5. Seller: Watch status update to "In Transit" ✅
6. (Optional) Wait or manually advance time ⏳
7. Seller: Status reaches "Listed for Sale" ✅
8. Buyer: Browse Second-Hand → See listing ✅

Done! 🎉
