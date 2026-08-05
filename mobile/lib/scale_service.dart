import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Shared live state from the connected scale.
///
/// The BLE connection is owned by the scale screen, which already receives
/// weight, barcode and status notifications. Rather than restructure that
/// working code — or lift the whole connection into a provider — the screen
/// pushes each value here as it arrives, and every other tab reads from these
/// notifiers.
///
/// Deliberately a singleton: there is exactly one physical scale connected at a
/// time, and the count and spec-capture flows are meaningless without it.
class ScaleService {
  ScaleService._();
  static final ScaleService instance = ScaleService._();

  /// Raw weight string as the firmware reports it (e.g. "1204.5").
  final ValueNotifier<String> weightRaw = ValueNotifier<String>('--');

  /// Most recent barcode seen, or null if none this session.
  final ValueNotifier<String?> barcode = ValueNotifier<String?>(null);

  /// Firmware status string ("place_weight", "stable", …).
  final ValueNotifier<String> status = ValueNotifier<String>('');

  final ValueNotifier<bool> connected = ValueNotifier<bool>(false);

  /// Serial of the connected unit, for display and device auth.
  final ValueNotifier<String> serial = ValueNotifier<String>('');

  /// API base URL. Configured on the scale screen (and read back from the
  /// device over BLE), but every tab needs it, so it lives here.
  final ValueNotifier<String> serverUrl = ValueNotifier<String>('');

  /// Emits every barcode as it is scanned, including repeats of the same code.
  ///
  /// [barcode] alone is not enough for count mode: rescanning the same bottle
  /// to correct a mistake would not change the value and so would not notify.
  final StreamController<String> barcodeStream =
      StreamController<String>.broadcast();

  /// Parsed grams, or null when the scale has not reported a usable number.
  double? get weightGrams {
    final parsed = double.tryParse(weightRaw.value.trim());
    if (parsed == null || parsed.isNaN || parsed.isInfinite) return null;
    return parsed;
  }

  /// True when the reading looks settled enough to record.
  ///
  /// The firmware does its own stability detection before reporting a weight
  /// with a scan, but a free-running weight notification can still be drifting.
  /// This is a UI hint only — it never blocks the operator from capturing.
  bool get looksStable {
    final w = weightGrams;
    if (w == null) return false;
    final s = status.value.toLowerCase();
    if (s.contains('place') || s.contains('wait')) return false;
    return w > 0;
  }

  void setWeight(String raw) => weightRaw.value = raw;
  void setStatus(String value) => status.value = value;
  void setConnected(bool value) {
    connected.value = value;
    if (!value) {
      weightRaw.value = '--';
      status.value = '';
    }
  }

  void setSerial(String value) => serial.value = value;

  /// Set the API base URL, optionally writing it through to storage.
  ///
  /// The scale screen persists its own copy under the same key, so it passes
  /// `persist: false` and this just mirrors the value for other tabs. The
  /// Account tab passes `persist: true`, because it is the one place the URL
  /// can be set without a scale connected.
  void setServerUrl(String value, {bool persist = false}) {
    serverUrl.value = value;
    if (persist) {
      SharedPreferences.getInstance().then(
        (prefs) => prefs.setString(_serverUrlKey, value),
      );
    }
  }

  static const _serverUrlKey = 'server_url';

  /// Load the stored URL immediately at startup.
  ///
  /// The scale screen also loads this, but it does so asynchronously as part of
  /// restoring the whole BLE device, and the other tabs are built before that
  /// finishes. Loading it here as well means a tab that opens straight after
  /// launch has a URL to work with instead of reporting it as unconfigured.
  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString(_serverUrlKey) ?? '';
    if (url.isNotEmpty) serverUrl.value = url;
  }

  /// Normalised base URL, or null when nothing usable is configured.
  String? get baseUrl {
    final raw = serverUrl.value.trim();
    if (raw.isEmpty) return null;
    var url = raw.replaceAll(RegExp(r'/+$'), '');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://$url';
    }
    return url;
  }

  void setBarcode(String code) {
    barcode.value = code;
    if (!barcodeStream.isClosed) barcodeStream.add(code);
  }
}
