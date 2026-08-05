# SmartBar Scale — Real-Data Readiness

Covers `webapp/smartbar-functions/functions/src`, `webapp/smartbar-client/src`, `mobile/lib/main.dart`, `firmware/src/main.cpp`.

**Status:** the backend, dashboard and mobile app are ready for a real-data pilot. The firmware is not — it still drops scans when Wi-Fi is down and does not verify TLS. See "Firmware" below.

`npm test` in `webapp/smartbar-functions/functions` runs 112 assertions covering the auth layer, shift-window and timezone math, pour-cost arithmetic, dashboard aggregation end-to-end against an in-memory Firestore, and catalog spec parsing.

---

## Before the first pilot — human actions

These cannot be done from code and are all blocking:

1. **Revoke the old Gemini API key in Google Cloud Console.** It was committed and is still in git history (commit `62e3ae7`). Removing it from HEAD does not invalidate it. Restrict the replacement to the Generative Language API.
2. **Rotate `SECRET_TOKEN`.** It is still `supersecretkey123` in `functions/.env`. It signs every user and device JWT — anyone with this value can forge either. Use 32+ random bytes.
3. **Deploy indexes and rules before any real traffic:** `firebase deploy --only firestore:indexes,firestore:rules,storage`. Index builds take minutes on a populated database; queries fail until they finish.
4. **Backfill catalog specs, then verify by hand:**
   ```bash
   gcloud auth application-default login   # required; see below
   cd webapp/smartbar-functions/functions
   npm run backfill:specs -- --dry-run     # review what it would change
   npm run backfill:specs -- --commit
   ```

   The script runs locally against Firestore using Application Default
   Credentials. If it fails with `invalid_rapt` or `invalid_grant`, your ADC has
   gone stale (organisations commonly require periodic reauth) — run
   `gcloud auth application-default login` again.

5. **Catalog integrity — verified clean. No action needed.**
   ```bash
   npm run audit:duplicates          # read-only report
   ```

   Measured against the live database:

   | | |
   |---|---|
   | Documents | 8,049 |
   | Distinct barcodes | 8,049 |
   | Duplicate barcodes | 0 |
   | Distinct products (name + volume) | 8,044 |
   | Products sharing a name+volume | 5 (0.06%) |
   | …of those, with differing fields | 2 |

   Every barcode resolves to exactly one document. The five name+volume
   collisions are normal catalog noise — genuine UPC/EAN variants, or different
   releases sharing a label. Two differ on `cost_per_bottle`; fix those by hand
   in the dashboard if they matter.

   `npm run dedupe:catalog` exists as a guard against true barcode collisions
   and currently has nothing to do. Keep it for after future imports.

   *Two earlier claims in this document were wrong and have been removed: that
   the database contained ~1,300 duplicate barcodes (inferred from
   `cleaned_catalog.json`, never true of the database), and that it held two
   documents per bottle under separate PLCB/manufacturer codes (inferred from
   the source spreadsheet, also not true). Both were corrected by running the
   audit against the real data.*

   **Check the project line it prints before committing.** `firebase.ts` calls
   `initializeApp()` with no explicit project, so outside Cloud Functions the
   target comes from whatever ADC points at. Set `SMARTBAR_PROJECT_ID` to have
   the script refuse to run against anything else:
   ```bash
   export SMARTBAR_PROJECT_ID=smartbar-7418f
   ```
   Empty-bottle weights are **estimated by bottle format** and can be off by 100g+. Every touched product is marked `specs_estimated: true`. Weigh your real bottles and correct them on the Products page before trusting pour-cost figures.
5. **Everyone re-authenticates once.** Tokens now expire and the payload format changed. Legacy tokens are honoured for one deploy, then stop.
6. **Run `flutter analyze` and test the mobile app on a device.** No Dart toolchain was available in the environment where these changes were made, so the Flutter code is unverified by a compiler. See "Mobile" below.

---

## What was fixed

### Bottle specs are now writable end-to-end
The root cause of a dead dashboard. `calcVolumes()` returns 0 unless `bottle_full_weight_g`, `bottle_empty_weight_g` and `bottle_volume_ml` are all set, and nothing could set them.

- `upsertByBarcode` accepts and persists all five specs plus `par_level`, validates that full weight exceeds empty weight, and will not let a client that omits a field wipe a spec already recorded.
- Products page has an "Inventory & pricing specs" section with per-field guidance, a capability indicator (volume tracking / inventory value / revenue & pour cost), and a live preview that computes implied density and flags anything outside 0.6–1.5 g/ml — a transposed weight or a litres/millilitres mix-up is visible before saving.
- Flutter Add-Product form has the same fields and the same density check.
- `scripts/backfill_bottle_specs.ts` derives specs for the existing catalog. Volume parsing is tested against `750ml`, `1.75L`, `70cl`, `25.4 oz`, and the `quantity="1"` bottle-count trap.

### Live dashboard
`GET /api/dashboard` replaces `/api/demo/dashboard`, computed from `inventory_readings` + `inventory_events` + `bottles`, scoped by business.

- **Nothing is synthesised.** Missing inputs yield `null`, never an estimate; the `coverage` block reports each gap and the UI prompts for it. The `0.42/ml` revenue fallback is gone, as are the hardcoded KPI trends (`+8.3%`, `-12.1%`, `+5.7%` were string literals).
- **Shift attribution is real.** New `shifts` collection: local-time windows per business, validated non-overlapping, may cross midnight. Consumption is attributed by converting each reading's timestamp into the business timezone.
- **Pour cost** uses the industry definition (cost poured ÷ revenue from those pours) and is **weighted** across products. On a test fixture the naive mean gave 55% where the weighted figure was 21.4% — one rarely-poured bottle dominating.
- **Projection panels removed.** "Loss Prevention Opportunity" and "Tax Deduction Potential" derived dollar figures from invented multipliers (`waste × 0.45` = breakage, etc.) and presented them as financial guidance. Replaced with documented losses from real breakage/spoilage/comp/transfer events, plus a stock-received panel.
- **Bottle swaps and restocks** no longer corrupt consumption. A drop larger than one full bottle can't be a pour; it's excluded and listed in an "Unexplained Readings" panel rather than silently dropped, because a genuine loss looks identical. Stock increases are never counted as negative consumption.

### Opening count and stock entry
- `POST /api/inventory/opening-count` writes ordinary readings into the business's real collections, so a device scan a minute later differences against it like any other reading. No separate demo data model to reconcile.
- `POST /api/inventory/add-stock` logs a delivery *and* raises the sealed count, so a delivery isn't mistaken for a measurement anomaly.
- `POST /api/inventory/seed-sample` (admin) seeds a starting position from catalog products that have complete specs.

### Authentication
The old middleware verified a token if present but called `next()` on every path — including a missing token, an invalid signature and a deleted user. Nothing was rejected at the middleware layer, so any route that forgot its own check was public. Several were: the product catalog was writable by anyone who could reach the function.

- `attachIdentity` populates identity without rejecting; `requireAuth` gates everything except `/login`, `/device/login` and the two password-reset routes; `requireRole` and `requireBusinessMember` layer on top.
- **Tokens expire** — 12h for users, 30d for devices. The firmware already re-authenticates on 401/403, so no firmware change was needed.
- **Tokens carry only identifiers.** They previously embedded the entire user document including populated business records, which went stale on any edit and bloated every request header.
- Suspended and offboarded accounts stop working immediately, even with a cryptographically valid token.
- A device token cannot produce a user identity (a stolen scale must not grant dashboard access); a password-reset token is single-purpose and cannot be used as a session.
- Login no longer distinguishes "no such user" from "wrong password", and no longer logs password hashes to Cloud Logging.
- `requireBusinessMember` replaces `canAccess()`, which derived the model name from `req.route.path` and silently did nothing on every route except `/business/:id`.

### Demo decoupling
Demo status is now `devices.demo === true`, set explicitly via `PATCH /api/platform/devices/:id/demo`. It was inferred from a hardcoded serial allow-list, and device login **force-reassigned those serials to the demo business on every login** — silently reverting a real business assignment if either physical unit was deployed to a pilot bar. `claimUnknownScan` also ran on every product save in every tenant; it is now gated on the demo flag.

### Infrastructure
- `firestore.indexes.json` — 10 composite indexes covering every multi-field query. Missing these raises `FAILED_PRECONDITION` at runtime, not at deploy.
- `firestore.rules` / `storage.rules` — deny-all. No client touches Firestore directly; everything goes through the Admin SDK, which bypasses rules. Costs nothing operationally, closes direct access completely.
- `generateReport` gained a lower time bound. It previously scanned the business's entire reading history on every report.
- `bottle-stats` date filtering normalises both bounds to full ISO strings — comparing `2026-08-05` against `2026-08-05T13:22:00Z` silently excluded the final day.
- Legacy `webapp/server/` and `webapp/client/` deleted, along with the Angular build config that existed only to serve them (`angular.json`, `e2e/`, root `package.json`, `Procfile`, `tsconfig.json`, `proxy.conf.json`, `tslint.json`). Fixes applied to the wrong tree silently did nothing.
- `functions/lib/` untracked and gitignored; it was committed and carried a duplicate of the leaked API key.

---

## Mobile

The Flutter app now authenticates. It previously sent **no** `Authorization` header at all.

`SmartBarApi` authenticates as the device being configured, using the serial read over BLE — the same credential the firmware presents. Tokens are cached in `SharedPreferences` and refreshed automatically on a 401.

**One deliberate behaviour change:** listing businesses is a tenant-wide operation that a device credential must not perform, or any scale could enumerate every customer on the platform. Assigning a device to a business now prompts for staff credentials and signs in as a user. A user token, when present, takes precedence over the device token; an expired user session falls back to the device credential rather than locking the app out of the scan workflow.

**This code has not been compiled.** No Dart SDK was reachable from the build environment (blocked by network allowlist). Structure was verified by a brace/paren/bracket balance check against the original, every call site was reviewed by hand, and one real compile error found that way (a dangling `$uri` reference after a call-site replacement). Everything used is within the project's Flutter `>=3.29` floor — `FilledButton`, `Color.withValues`, `BuildContext.mounted`. Run `flutter analyze` before shipping.

---

## Firmware — not addressed, still blocking

Deferred by choice this pass; can't be compiled or flashed from here. All four remain open:

1. **TLS verification is disabled.** `client.setInsecure()` at `main.cpp:713, 765, 795`. Device JWTs and all scan data travel over unverified TLS — trivially intercepted on a bar's guest Wi-Fi. Pin the ISRG Root X1 CA or verify the cert fingerprint.
2. **No offline queue.** `postData()` drops the reading if Wi-Fi is down or the POST fails. Bar Wi-Fi is unreliable and every dropped scan is silent inventory loss. Buffer to NVS/SPIFFS and retry with backoff.
3. **No NTP.** Prevents TLS expiry validation (blocks #1) and means queued offline readings can't be timestamped (blocks #2). The device sends `millis()/1000` as `date`, which the server correctly ignores in favour of server time.
4. **Demo serial baked into recovery.** `DEFAULT_DEMO_DEVICE_ID` is adopted whenever the stored device ID is invalid or empty (`main.cpp:283, 298`). A real unit with corrupted NVS silently becomes a demo unit. Recovery should halt and signal an error.

Also open: no calibration factor or tare offset is sent with readings, so scale drift is undetectable in the data.

---

## Known limitations worth understanding

- **Shift attribution is schedule-based, not clock-in.** It attributes to a *shift*, not a person. If two people work the same window, the shift owns the numbers. Accuracy depends on the schedule matching who actually worked.
- **Sealed count has no device path.** Opening count and add-stock can set it, but no scale reports it, so sealed stock is only as current as the last manual entry.
- **Empty-bottle weights from the backfill are estimates.** See action 4 above.
- **Unexplained drops are excluded, not diagnosed.** The dashboard lists them; it can't distinguish a bottle swap from theft. That's a genuine limit of weight-only data.
- **No staging project.** `.firebaserc` has `"projects": {}` and the storage bucket is hardcoded in `firebase.ts`. You'll be testing against production.
- **`base.getAll` / `count` read entire collections with no pagination.** `GET /api/bottles` on a large catalog is slow and expensive, and the opening-count modal calls it.
- **No error monitoring.** Controllers `console.error` and return `err.message` to the client, which leaks internals.
