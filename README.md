# SmartBar Scale

SmartBar Scale is a connected bar-inventory system. A bottle is scanned, weighed on an HX711 load-cell scale, and reported to the SmartBar cloud. The system identifies the bottle, tracks liquid on hand and consumption, and presents operational and financial insight in a web dashboard.

This repository contains:

```text
webapp/    Firebase Functions API, catalog, inventory services, and dashboard
mobile/    Flutter iOS/Android app for operating and configuring a scale
firmware/  PlatformIO ESP32 firmware for the scale and barcode reader
```

## Capabilities

- Barcode-based bottle identification and weight readings.
- Product and hierarchical category catalog with images and product details.
- Per-product price per pour (`pour_price`) and pour size (`pour_volume_ml`).
- Full-bottle and empty-bottle weights for accurate volume estimates.
- Demo Bar mode that can use any valid catalog bottle scanned by a customer.
- Device registration, serial identity, business assignment, and JWT authentication.
- BLE configuration for Wi-Fi, server URL, device ID, tare, and calibration.
- Dashboard inventory, consumption, waste, revenue, alerts, and recommendations.

## End-to-end scan flow

1. The USB HID barcode scanner sends a barcode report to the ESP32.
2. The ESP32 waits for a stable HX711 weight.
3. Firmware posts the barcode, weight, device serial, and JWT to `POST /api/bottle-stats`.
4. The API performs an exact lookup in Firestore's `bottles` collection. External barcode enrichment is disabled to prevent incorrect matches.
5. A matched product creates a bottle-stat and inventory reading for the device business. Demo devices also update `demo_inventory` and `demo_events`.
6. An unknown barcode is retained as an unmatched Demo Bar event. The mobile app can collect the product details and image; saving the product allows the event to be promoted into Demo Bar inventory.

## Mobile application

The Flutter app is in `mobile/`.

### Device and Wi-Fi setup

The app discovers `OmniScale-*` devices over BLE and displays connection state, live weight, barcode, Wi-Fi state/IP, serial number, and business assignment. Wi-Fi setup requests scan results from the ESP32 over BLE, lists nearby networks, and also supports manual SSID entry. The app can write Wi-Fi credentials, server URL, and device ID.

### Product workflow

When a barcode arrives, the app calls `GET /api/product/{barcode}` against the master catalog. A match displays product details. If no exact match exists, an Add Product form accepts the name, brand, category, image, quantity, weight, origin, ingredients, description, price per pour, and pour size. The form writes to `PUT /api/product/{barcode}` and uploads images through `/api/product/{barcode}/image`.

The category picker stores category document IDs, not display paths. The app includes TARE and CALIBRATE controls. Calibration sends `calibrate:<reference_grams>` to the ESP32 after a known mass is placed on the scale.

Run the app:

```bash
cd mobile
flutter pub get
flutter analyze
flutter run
```

## ESP32 firmware

The PlatformIO project is in `firmware/`. It uses the Arduino ESP32 framework, HX711, NimBLE, ESP32 USB Soft Host, Wi-Fi, HTTPS, ArduinoJson, and Preferences. USB host initialization runs before Wi-Fi/BLE because its timer is timing-sensitive.

Default pins:

```text
HX711 DOUT: GPIO 4     HX711 SCK: GPIO 13
USB D+: GPIO 16        USB D-: GPIO 17
Buzzer: GPIO 25
```

Demo build identities:

```text
demo-unit-a: SB_B017B2215788
demo-unit-b: SB_A40FB1215788
```

Existing ESP32 NVS settings take precedence over build defaults.

Build/upload:

```bash
cd firmware
pio run -e demo-unit-b
pio run -e demo-unit-b --target upload --upload-port /dev/cu.usbserial-0001
pio device monitor -b 115200
```

Calibration: remove all weight and tare, place a known reference mass, then use the app's CALIBRATE control. The calculated factor is saved in NVS. Do not use a bottle's printed volume as a calibration mass unless its actual mass is known.

## Web application and API

`webapp/` contains the React dashboard in `smartbar-client/`, Firebase Functions in `smartbar-functions/functions/`, the legacy Angular client in `client/`, and catalog/import assets.

Important routes:

```text
POST /api/device/login
GET  /api/product/:barcode
PUT  /api/product/:barcode
POST /api/product/:barcode/image
POST /api/bottle-stats
GET  /api/inventory/readings
POST /api/inventory/reading
GET  /api/demo/dashboard
POST /api/demo/seed
POST /api/demo/simulate
POST /api/demo/reset
```

Device login accepts a serial number and returns a JWT. The two demo serials are automatically associated with the `demo-bar` business. Device uploads use the JWT as a Bearer token.

## Firestore collections

| Collection | Purpose |
| --- | --- |
| `bottles` | Master barcode catalog, bottle specs, cost, and pour pricing |
| `categories` | Hierarchical category tree |
| `devices` | Device serial, status, and business assignment |
| `bottle-stats` | Raw barcode/weight scan records |
| `inventory_readings` | Business inventory snapshots and volume changes |
| `inventory_events` | Deliveries, breakage, comps, and manual events |
| `demo_inventory` | Current Demo Bar product snapshot |
| `demo_events` | Demo consumption, waste, delivery, and unmatched events |
| `businesses` / `users` | Customer accounts, locations, and access |

`demo_inventory` is a working snapshot, not the master catalog. A valid catalog product scanned by a demo device is copied into it automatically.

## Dashboard calculations

### Bottle volume

Volume is derived from an explicit millilitre quantity, then litre quantity, then numeric weight for imported liquor records where `quantity` is a bottle count such as `"1"` and `weight` is `"750"`. If no usable value exists, the fallback is 750 ml.

### Weight to volume

```text
liquid_weight = measured_weight - empty_bottle_weight
full_liquid_weight = full_bottle_weight - empty_bottle_weight
open_volume_ml = liquid_weight / full_liquid_weight * bottle_volume_ml
total_on_hand_ml = open_volume_ml + sealed_count * bottle_volume_ml
```

### Consumption and waste

```text
measured_loss = previous_total_volume
                + delivered_bottles * bottle_volume_ml
                - current_total_volume
consumed_ml = max(measured_loss, 0)
waste_ml = max(consumed_ml - expected_consumed_ml, 0)
```

The first scan of a newly added bottle establishes its current state and is not counted as consumption. Later scans calculate the change from the previous scale state.

### Inventory cost and revenue

```text
on_hand_value = on_hand_ml / bottle_volume_ml * cost_per_bottle
consumed_cost = consumed_ml / bottle_volume_ml * cost_per_bottle
sales_revenue = consumed_ml / pour_volume_ml * pour_price
```

The red value beneath Consumed is product cost, not sales revenue. Configured sales revenue is shown separately and contributes to the Revenue KPI. Products without pour pricing use a demo fallback estimate.

### KPIs and alerts

- Inventory On Hand: sum of current on-hand values.
- Weekly Consumption: consumption cost/events for the dashboard period.
- Weekly Waste: breakage and waste values.
- Revenue: per-product pour revenue from consumption events.
- Average Pour Cost: average stored `pour_cost_pct`.
- Alerts: products above the pour-cost or waste thresholds.

The demo shift cards and some recommendation text are deterministic demonstration data; production dashboards should replace them with live shift and POS data.

## Demo controls

- **Seed Demo Bar** copies catalog products into `demo_inventory` and creates historical `demo_events`.
- **Run Busy Friday** writes one calculated event using product, scale weight, expected consumption, sealed bottles, and deliveries.
- **Reset Demo** removes the demo inventory/events snapshot.

These controls write real Firestore documents; they are not browser-only mock state.

## Deployment

From `webapp/`:

```bash
npm install
cd smartbar-functions/functions
npm install
npm run build
cd ../..
firebase deploy --only functions,hosting
```

Supply `STRIPE_SECRET_KEY` and other credentials through deployment environment configuration. Do not commit `.env` files or payment credentials.

## Limitations and roadmap

- POS integrations are planned; current revenue can be calculated from pour economics, but POS revenue is not imported.
- AI recommendations are currently rule/data-driven demo insights and should be connected to an auditable production model.
- Wi-Fi scanning depends on ESP32 BLE/firmware behavior and can be replaced with native mobile discovery where platform permissions allow.
- Production multi-location dashboards and consolidated reporting require live business/location selection wired to customer inventory.
