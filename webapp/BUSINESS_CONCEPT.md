# SmartBar — Intelligent Inventory Management System

## Executive Summary

SmartBar is an automated inventory management platform that combines IoT hardware (precision scales with barcode scanners), cloud intelligence, and AI-driven analytics to give hospitality businesses real-time visibility into their inventory consumption, waste, and financial performance.

The system replaces manual bottle counting and guesswork with continuous, weight-based tracking — turning every pour, delivery, and breakage into structured data that drives smarter decisions.

---

## The Problem

### For Bars, Restaurants, and Hotels

- **Shrinkage is invisible.** The average bar loses 20–25% of revenue to over-pouring, theft, free giveaways, and spoilage — most of it undetected.
- **Manual inventory is painful.** Staff spend hours counting bottles, estimating fill levels by eye, and transcribing data into spreadsheets. The results are inaccurate and infrequent.
- **No real-time data.** Owners only discover problems weeks later — if they discover them at all.
- **Tax reporting is a burden.** End-of-year loss claims require documentation that most businesses cannot produce.
- **Ordering is reactive.** Stock-outs happen because reorder decisions are based on gut feel, not data.

### The Cost of Doing Nothing

A mid-size bar with $500K in annual liquor sales typically loses $100K–$125K to untracked shrinkage. Even a 5% recovery through better tracking pays for the system many times over.

---

## The Solution

### Hardware: SmartBar Scale

A compact, purpose-built IoT device that sits on the bar or in the stockroom:

| Component | Detail |
|---|---|
| **Microcontroller** | ESP32 (WiFi + Bluetooth LE) |
| **Load Cell** | HX711-based precision scale (±0.5g accuracy) |
| **Scanner** | USB Host omnidirectional barcode scanner (HID keyboard emulation) |
| **Feedback** | Piezo buzzer for audible state cues |
| **Connectivity** | WiFi for data upload; BLE for mobile app configuration |
| **Power** | USB-C powered, with deep sleep for energy efficiency |

#### How It Works

1. **Power on** — device beeps, auto-calibrates, and tares the scale.
2. **Scan** — staff scans a bottle's barcode with the built-in scanner. Device beeps to confirm.
3. **Weigh** — staff places the bottle on the scale. Weight stabilizes within 500ms.
4. **Upload** — device sends `{ device_id, barcode, weight }` to the cloud via HTTPS.
5. **Repeat** — remove the bottle, the scale auto-tares, ready for the next scan.

The device operates independently. No app interaction is required for daily use. WiFi credentials are configured once via the mobile app over Bluetooth.

### Software: Three Interfaces

#### 1. Mobile App (Flutter — iOS & Android)

- **BLE provisioning** — scan for SmartBar devices, configure WiFi, view device status.
- **Live feed** — see barcode scans and weights as they happen.
- **Product lookup** — scanned barcodes resolve to full product details (name, brand, category, image, volume, country of origin, ingredients, nutrition).
- **Product entry** — if a product isn't in the database, staff can add it on the spot with photo capture.
- **Business assignment** — displays the business the device is assigned to.

#### 2. Web Dashboard (React)

- **Inventory dashboard** — real-time view of all products tracked, total volume on hand, total value.
- **Readings feed** — chronological stream of every scan with volume change indicators.
- **Sessions** — optional named tracking periods (e.g., "Monday Full Count", "Weekly Audit") for structured comparison.
- **Events** — log deliveries, breakage, comps, transfers, and spoilage between scans.
- **Reports** — generate consumption reports for any date range with detailed breakdowns.
- **Product database** — full CRUD for product catalog with hierarchical categories (up to 5 levels).
- **Device management** — admin can assign devices to businesses, monitor connectivity.
- **User management** — role-based access (admin, manager, staff).

#### 3. Cloud Backend (Firebase)

- **Firestore** — real-time database for products, readings, sessions, events, reports.
- **Cloud Functions** — Node.js/Express API handling authentication, product lookup, inventory logic.
- **Firebase Storage** — product images (upload, camera capture, or URL).
- **Product resolution chain** — Local DB → Open Food Facts → Gemini AI fallback.

---

## Inventory Tracking Model

### Core Philosophy: Continuous Data, Optional Structure

SmartBar uses a **continuous stream** model rather than rigid session-based tracking:

```
┌─────────────────────────────────────────────────────────┐
│                   CONTINUOUS DATA STREAM                 │
│                                                         │
│   Device scans flow in 24/7 as timestamped readings     │
│   Each reading auto-diffs against the previous one      │
│   for the same product to calculate consumption         │
│                                                         │
│   ┌───┐  ┌───┐  ┌───┐  ┌───┐  ┌───┐  ┌───┐  ┌───┐    │
│   │ R │  │ R │  │ R │  │ R │  │ R │  │ R │  │ R │    │
│   └───┘  └───┘  └───┘  └───┘  └───┘  └───┘  └───┘    │
│      │      │      │      │      │      │      │       │
│      └──────┴──────┴──┬───┴──────┴──────┴──────┘       │
│                       │                                 │
│            ┌──────────┴──────────┐                      │
│            │  Optional Session   │                      │
│            │  "Tuesday Count"    │                      │
│            └─────────────────────┘                      │
└─────────────────────────────────────────────────────────┘
```

**Layer 1 — Readings (always on):**
Every time a product is scanned and weighed, a reading is created with:
- Timestamp, device ID, barcode, weight
- Estimated liquid volume (derived from weight, known bottle tare, and full volume)
- Sealed bottle count
- Total volume on hand and dollar value
- Auto-calculated change from the previous reading of the same product

**Layer 2 — Sessions (opt-in):**
When a business wants to do a deliberate, labeled inventory count (e.g., "Monday opening", "End of week audit"), they start a session from the web or mobile app. All readings during an active session are tagged with that session ID for later comparison. Sessions can be paused, resumed, or closed.

**Layer 3 — Events:**
Deliveries, breakage, comps, transfers, and spoilage are logged as events with quantities. Reports factor these into consumption calculations.

**Layer 4 — Reports:**
Time-range consumption reports that show:
- Starting inventory value → ending inventory value
- Deliveries received
- Consumption (sales)
- Waste (breakage + comps + spoilage)
- Per-product breakdown with volume and dollar figures
- Visual flow charts

### Volume Estimation

For liquid products, volume is calculated from weight using known bottle specifications:

```
Liquid Weight   = Current Weight − Empty Bottle Weight
Fill Ratio      = Liquid Weight / (Full Bottle Weight − Empty Bottle Weight)
Estimated Volume = Fill Ratio × Bottle Volume (ml)
```

This converts a raw weight reading into a meaningful business metric: *how much product is left in this bottle?*

---

## Where AI Creates Value

AI is not a bolt-on feature — it is the intelligence layer that transforms raw weight data into actionable business insights. Here is how AI adds value across the platform:

### 1. Anomaly Detection

**What it does:** Monitors the continuous stream of readings and flags unusual patterns in real time.

**Examples:**
- A bottle of premium whisky drops 200ml between 2am and 6am when the bar was closed → **possible theft alert**
- A bartender's shift consistently shows 15% more consumption than other shifts → **over-pouring pattern**
- A product shows a sudden spike in consumption that doesn't correlate with sales → **unrecorded giveaways**
- A bottle's weight increased without a delivery event logged → **data anomaly / possible swap**

**Business value:** Catches losses that would otherwise go unnoticed for weeks or months. Even identifying one theft incident per month can save thousands annually.

### 2. Predictive Ordering & Par Level Optimization

**What it does:** Analyzes historical consumption patterns to predict when each product will need reordering.

**Examples:**
- "Based on the last 90 days, you'll run out of Absolut Vodka by Thursday. Reorder by Tuesday."
- "Your Grey Goose consumption increases 40% on weekends. Adjust par levels for Friday delivery."
- "You've been over-ordering Hendrick's Gin — average weekly usage is 2.3 bottles but you're ordering 4."
- Seasonal adjustments: "Pimm's consumption drops 80% after September. Reduce winter order."

**Business value:** Reduces stock-outs (lost sales) and over-ordering (tied-up capital, potential spoilage). Optimizes cash flow.

### 3. Smart Business Insights & Cost Analysis

**What it does:** Aggregates data across products, time periods, and locations to surface trends and recommendations.

**Examples:**
- **Pour cost analysis:** "Your average pour cost is 24%. Industry benchmark is 18–22%. Here's where you're over-pouring."
- **Menu optimization:** "Cocktails using Maker's Mark have a 31% pour cost vs. 19% for Jack Daniel's alternatives."
- **Profitability ranking:** "Your top 5 products by volume are not your top 5 by margin. Consider promoting these instead."
- **Waste reports:** "You lost $847 to breakage and $1,230 to comps this month. That's 12% above your 3-month average."
- **Period comparison:** "This week vs. last week: consumption up 8%, but sales only up 3%. Investigate the gap."

**Business value:** Turns raw data into financial intelligence. Owners see exactly where money is going and where to optimize.

### 4. Product Recognition & Data Enrichment

**What it does:** When a barcode isn't found in the local database or Open Food Facts, AI identifies the product from images or context.

**Current implementation:**
- Google Gemini (`gemini-2.5-flash` with `google_search` tool) as the fallback in the product lookup chain
- Accepts barcode numbers and returns structured product data (name, brand, category, volume, ingredients, nutrition)

**Future capabilities:**
- **Image-based recognition:** Staff photographs an unlabeled bottle → AI identifies the product from the label
- **Receipt scanning:** Photograph a delivery invoice → AI extracts product names, quantities, and costs into the system
- **Menu parsing:** Upload a cocktail menu → AI maps recipes to inventory products for theoretical cost analysis

**Business value:** Reduces manual data entry. Every product gets into the system faster with richer data.

### 5. Natural Language Queries

**What it does:** Allows owners and managers to ask questions about their inventory in plain English instead of navigating dashboards.

**Examples:**
- *"How much Hennessy did we go through last week?"*
- *"Which products have the highest waste percentage?"*
- *"Compare this month's consumption to the same month last year."*
- *"What's my total inventory value right now?"*
- *"Show me products we haven't scanned in over 7 days."*
- *"Which bartender shift has the highest pour cost?"*

**Business value:** Democratizes data access. A busy owner can get answers from their phone without technical knowledge.

### 6. Tax & Compliance Intelligence

**What it does:** Automatically generates documentation for tax reporting, insurance claims, and regulatory compliance.

**Examples:**
- **Loss documentation:** Itemized records of breakage, spoilage, and theft with timestamps, weights, and dollar values — ready for tax deduction claims.
- **Inventory valuation:** End-of-period inventory snapshots with FIFO/LIFO cost basis calculations.
- **Consumption reporting:** Jurisdictions that require alcohol consumption reporting get automated, accurate data.
- **Audit trail:** Every reading is timestamped and linked to a device, making the data defensible in an audit.

**Business value:** Saves hours of manual record-keeping. Maximizes legitimate tax deductions that most businesses miss because they lack documentation.

### 7. Multi-Location Intelligence

**What it does:** For businesses with multiple locations, AI compares performance across sites to identify best practices and problem areas.

**Examples:**
- "Location A has 18% pour cost while Location B has 26%. Here's the product-by-product breakdown."
- "Location C's Tuesday consumption pattern doesn't match its sales — investigate."
- "Consolidate orders across locations to hit volume discount thresholds."

**Business value:** Scales oversight without scaling management headcount.

---

## Expansion Roadmap

### Phase 1: Spirits & Liquor (Current)
Weight-based tracking of bottled spirits, wine, and beer. The core use case with the highest ROI per unit.

### Phase 2: Beverages & Packaged Goods
Extend to non-alcoholic beverages (coffee beans, syrups, juices), cooking oils, sauces — any product sold by volume or weight from a container.

### Phase 3: Produce & Perishables
Weigh incoming produce deliveries against invoices. Track daily usage. AI predicts spoilage based on consumption velocity and shelf life.

### Phase 4: Full Kitchen Inventory
Integrate with POS systems to compare theoretical usage (what recipes say you should use) vs. actual usage (what the scale says you used). The gap is your waste.

### Phase 5: Industry Verticals
- **Pharmacies** — controlled substance inventory tracking
- **Cannabis dispensaries** — regulatory weight compliance
- **Chemical / industrial** — material consumption tracking
- **Retail** — bulk goods inventory

---

## System Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  SmartBar    │     │  Mobile App  │     │   Web App    │
│  ESP32 Scale │     │   (Flutter)  │     │   (React)    │
│              │     │              │     │              │
│  HX711 Scale │     │  BLE Config  │     │  Dashboard   │
│  USB Scanner │     │  Live Feed   │     │  Sessions    │
│  WiFi + BLE  │     │  Product Add │     │  Reports     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │    HTTPS POST      │    REST API        │   REST API
       │  { barcode,        │                    │
       │    weight,         │                    │
       │    device_id }     │                    │
       │                    │                    │
       └────────────┬───────┴────────────────────┘
                    │
          ┌─────────▼──────────┐
          │   Firebase Cloud   │
          │   Functions (API)  │
          │                    │
          │  Auth · Products   │
          │  Inventory · AI    │
          └─────────┬──────────┘
                    │
       ┌────────────┼────────────┐
       │            │            │
  ┌────▼────┐  ┌────▼────┐  ┌───▼────┐
  │Firestore│  │Firebase │  │External│
  │         │  │Storage  │  │  APIs  │
  │Products │  │         │  │        │
  │Readings │  │Product  │  │OpenFood│
  │Sessions │  │Images   │  │Gemini  │
  │Events   │  │         │  │        │
  │Reports  │  │         │  │        │
  └─────────┘  └─────────┘  └────────┘
```

---

## Data Collections

| Collection | Purpose |
|---|---|
| `bottles` | Product catalog — name, brand, barcode, category, volume, weights, image, nutrition |
| `bottle-stats` | Raw device scan records — barcode, weight, device, timestamp |
| `inventory_readings` | Enriched readings with volume estimates, value, and auto-diff from previous |
| `inventory_sessions` | Optional named tracking periods with status lifecycle |
| `inventory_events` | Deliveries, breakage, comps, transfers, spoilage |
| `consumption_reports` | Generated reports with per-product and aggregate analysis |
| `devices` | Registered IoT devices with business assignments |
| `businesses` | Business entities |
| `users` | User accounts with role-based access |
| `categories` | Hierarchical product categories (up to 5 levels) |

---

## Revenue Model (Proposed)

| Tier | Target | Pricing | Includes |
|---|---|---|---|
| **Starter** | Single location, < 50 products | $49/mo | 1 device, basic dashboard, manual reports |
| **Professional** | Single location, unlimited products | $149/mo | Up to 3 devices, AI insights, automated reports, anomaly alerts |
| **Enterprise** | Multi-location | $99/mo per location | Unlimited devices, cross-location analytics, API access, dedicated support |
| **Hardware** | All tiers | $299 per device (one-time) | SmartBar Scale unit with scanner |

---

## Competitive Advantages

1. **Zero-friction data capture.** Scan and weigh — no typing, no apps to open, no training needed.
2. **Continuous, not periodic.** Data flows in real time, not once a week during a painful manual count.
3. **AI-native.** Intelligence is built into the core, not bolted on. The system gets smarter with every reading.
4. **Hardware + software integration.** Purpose-built device eliminates the "bring your own scale" problem.
5. **Expandable.** The same platform scales from a single bar to a multi-location enterprise, and from liquor to any weighable product.

---

## Summary

SmartBar transforms inventory management from a manual, error-prone chore into an automated, AI-powered intelligence system. By combining purpose-built IoT hardware with cloud analytics and machine learning, it gives businesses the data they need to reduce waste, prevent theft, optimize ordering, and maximize profitability — all from a simple scan-and-weigh workflow.

The AI layer is what elevates SmartBar from a "smart scale" to a business intelligence platform. It doesn't just record data — it interprets it, flags problems, predicts needs, and generates the documentation that saves money at tax time.

Every bottle weighed is a data point. Every data point is an insight. Every insight is money saved.
