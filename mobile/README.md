# SmartBar mobile

Flutter app for operating a SmartBar scale and managing bar inventory from the floor.

```bash
cd mobile
flutter pub get
flutter analyze      # run this — see "Verification" below
flutter run
```

## Structure

```text
lib/
  main.dart             App shell (bottom tabs) + the scale screen: BLE connect,
                        Wi-Fi setup, device config, scan → product lookup/edit
  api.dart              SmartBarApi — authenticated HTTP client
  scale_service.dart    Shared live scale state (weight, barcode, status)
  spec_capture.dart     Guided bottle measurement using the live scale
  count_screen.dart     Count mode — walk the bar, submit an opening count
  events_screen.dart    Log breakage, spoilage, comps, deliveries
  inventory_screen.dart Stock position, pour cost, low stock, pricing edits
  account_screen.dart   Staff sign-in and session
```

## Tabs

**Scale** — unchanged: connect over BLE, configure Wi-Fi and server URL, tare
and calibrate, scan a barcode to look up or add a product. New: a ruler icon on
the product card opens guided measurement, because the bottle is physically on
the scale at that moment.

**Count** — start counting, then for each bottle: put it on the scale, scan it,
enter how many sealed bottles sit behind it. The whole count is held locally and
submitted at the end as one opening count. That's deliberate — a count is a
statement about a single moment, and submitting readings one at a time as you
walk would spread that moment across an hour and make the gaps between them look
like consumption. Rescanning a bottle replaces its earlier entry rather than
adding a duplicate.

**Log** — breakage, comps, spoilage and deliveries, recorded as they happen.
These are what separate a documented loss from an unexplained one; without them
every shortfall looks like theft. Scan the bottle if it's in your hand, or search.

**Inventory** — per-product stock, value and pour cost, sorted so what needs
attention floats up (below par first, then unmeasured products). Inline editing
of pour price, pour size, cost and par level, with live pour cost as you type.

**Account** — staff sign-in and the server URL.

## Server URL

The API base URL is shared state on `ScaleService`, with three writers:

1. Restored from `SharedPreferences` at launch, synchronously, before the tabs
   need it.
2. Read from the scale over BLE when one connects.
3. Set by hand on the Account tab.

That third route exists because the URL used to be settable *only* through the
device config dialog, which requires an active BLE connection — so a fresh
install with no scale nearby had no way to reach the API and every tab reported
"no server URL configured" with no way to fix it.

Tabs listen to the notifier rather than reading it once at build time. `IndexedStack`
builds every tab at launch, which is earlier than the async restore completes, so
a one-shot read would always miss it.

## Authentication

Two credentials with deliberately different authority:

| | Device token | User token |
|---|---|---|
| Source | Scale serial, read over BLE | Staff email + password |
| Can | Look up products, post scans | Everything the user's role allows |
| Cannot | Read stock levels or costs, log events, count | — |
| Lifetime | 30 days | 12 hours |

Scanning works without signing in, so a shared bar device stays useful.
Anything business-scoped needs a real account: those actions are attributed to a
person, and stock levels and costs are a tenant's private financial data — a
scale credential must not expose them.

Signing out drops the user token but keeps the device token, so scanning
survives a manager signing out. The client refreshes whichever credential was in
use on a 401; an expired staff session falls back to the device token rather
than locking the app out of the scan workflow.

## Why guided measurement matters

The catalog backfill can only *estimate* empty-bottle weight from bottle format.
Real glass weight varies by well over 100 g depending on punt depth and
thickness. On a 750 ml bottle a 100 g error is roughly 13% of the liquid weight,
and that error flows straight into pour cost — the number a bar actually acts on.

Products backfilled with an estimate carry `specs_estimated: true` and show an
"estimated weight" tag in the Inventory tab. Measuring one clears the flag.

Measure the products you pour most first; the top 20 typically cover most volume.

## Verification

**`flutter analyze` has not been run against these changes.** No Dart SDK was
reachable from the environment where they were written (the SDK download is
blocked by a network allowlist), so the Dart is verified by structural review
rather than by a compiler:

- brace/paren/bracket balance on every file, compared against the original
- every cross-file symbol resolves to a definition
- every widget constructor call site matches its definition (names and required params)
- every method called on `SmartBarApi` and `ScaleService` exists
- version-sensitive Flutter APIs checked against usage that already compiles in
  the original app — this caught `DropdownButtonFormField.initialValue`, which
  exists only on Flutter 3.35+ while this project's floor is 3.29

Run `flutter analyze` before shipping. Expect lint-level findings (unused
imports, style) rather than structural errors — but don't assume it.
