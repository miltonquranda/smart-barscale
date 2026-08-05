import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Raised when an operation needs staff credentials the app doesn't have.
class NeedsSignIn implements Exception {}

/// Authenticated API client.
///
/// Two credentials, deliberately different in authority:
///
///   * A **device token**, obtained from the serial the app reads over BLE.
///     Enough to look up products and post scans — the same authority the
///     firmware has.
///   * A **user token**, from staff email/password. Required for anything
///     business-scoped: inventory counts, event logging, pricing, financials.
///     A scale credential must not be able to read a bar's cost data or
///     enumerate other tenants.
///
/// The user token takes precedence when present. On a 401 the client refreshes
/// whichever credential was in use; an expired staff session falls back to the
/// device token rather than locking the app out of scanning.
class SmartBarApi {
  static String? _deviceToken;
  static String? _userToken;
  static String? _serial;
  static Map<String, dynamic>? _user;

  static const _deviceTokenKey = 'api_token';
  static const _userTokenKey = 'api_user_token';
  static const _userKey = 'api_user';

  /// Notifies listeners when the signed-in user changes, so screens can rebuild
  /// without threading callbacks through every widget.
  static final ValueNotifier<Map<String, dynamic>?> currentUser =
      ValueNotifier<Map<String, dynamic>?>(null);

  static bool get hasUserSession => _userToken != null;
  static Map<String, dynamic>? get user => _user;

  static String get userDisplayName {
    final u = _user;
    if (u == null) return '';
    final first = (u['firstName'] ?? '').toString().trim();
    final last = (u['lastName'] ?? '').toString().trim();
    final name = [first, last].where((p) => p.isNotEmpty).join(' ');
    return name.isNotEmpty ? name : (u['email'] ?? '').toString();
  }

  /// The business this user operates on. Null for accounts with none attached.
  static String? get businessName {
    final list = _user?['business'];
    if (list is List && list.isNotEmpty && list.first is Map) {
      return (list.first as Map)['name']?.toString();
    }
    return null;
  }

  /// Serial of the device currently being configured. A different device needs
  /// a different token, so switching clears the cached one.
  static void setSerial(String serial) {
    if (serial != _serial) {
      _serial = serial;
      _deviceToken = null;
    }
  }

  static Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();
    _deviceToken = prefs.getString(_deviceTokenKey);
    _userToken = prefs.getString(_userTokenKey);
    final raw = prefs.getString(_userKey);
    if (raw != null) {
      try {
        _user = jsonDecode(raw) as Map<String, dynamic>;
        currentUser.value = _user;
      } catch (_) {
        _user = null;
      }
    }
  }

  static Future<void> _persistDeviceToken(String? token) async {
    _deviceToken = token;
    final prefs = await SharedPreferences.getInstance();
    if (token == null) {
      await prefs.remove(_deviceTokenKey);
    } else {
      await prefs.setString(_deviceTokenKey, token);
    }
  }

  /// Exchange the device serial for a device token.
  static Future<bool> loginDevice(String baseUrl) async {
    final serial = _serial;
    if (serial == null || serial.isEmpty) return false;
    try {
      final resp = await http
          .post(
            Uri.parse('$baseUrl/api/device/login'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'serialNumber': serial}),
          )
          .timeout(const Duration(seconds: 15));
      if (resp.statusCode == 200) {
        final body = jsonDecode(resp.body) as Map<String, dynamic>;
        final token = body['token'] as String?;
        if (token != null && token.isNotEmpty) {
          await _persistDeviceToken(token);
          return true;
        }
      }
      debugPrint('Device login failed: ${resp.statusCode} ${resp.body}');
    } catch (e) {
      debugPrint('Device login error: $e');
    }
    return false;
  }

  /// Sign in as staff. Returns null on success, or an error message.
  static Future<String?> loginUser(
    String baseUrl,
    String email,
    String password,
  ) async {
    try {
      final resp = await http
          .post(
            Uri.parse('$baseUrl/api/login'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email, 'password': password}),
          )
          .timeout(const Duration(seconds: 20));
      final body = jsonDecode(resp.body) as Map<String, dynamic>;
      if (resp.statusCode == 200) {
        final token = body['token'] as String?;
        if (token != null && token.isNotEmpty) {
          _userToken = token;
          _user = body['user'] as Map<String, dynamic>?;
          currentUser.value = _user;
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString(_userTokenKey, token);
          if (_user != null) {
            await prefs.setString(_userKey, jsonEncode(_user));
          }
          return null;
        }
      }
      return body['error']?.toString() ?? 'Sign in failed (${resp.statusCode})';
    } catch (e) {
      return 'Could not reach the server.';
    }
  }

  static Future<void> signOutUser() async {
    _userToken = null;
    _user = null;
    currentUser.value = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_userTokenKey);
    await prefs.remove(_userKey);
  }

  static String? get _activeToken => _userToken ?? _deviceToken;

  static Map<String, String> _headers() => {
    'Content-Type': 'application/json',
    if (_activeToken != null) 'Authorization': 'Bearer $_activeToken',
  };

  static Future<http.Response> _send(
    String baseUrl,
    Future<http.Response> Function() attempt,
  ) async {
    if (_activeToken == null) await loginDevice(baseUrl);
    var resp = await attempt();
    if (resp.statusCode == 401) {
      if (_userToken != null) {
        await signOutUser();
      } else {
        await _persistDeviceToken(null);
        await loginDevice(baseUrl);
      }
      if (_activeToken != null) resp = await attempt();
    }
    return resp;
  }

  static Future<http.Response> get(
    String baseUrl,
    String path, {
    Duration timeout = const Duration(seconds: 15),
  }) => _send(
    baseUrl,
    () => http
        .get(Uri.parse('$baseUrl$path'), headers: _headers())
        .timeout(timeout),
  );

  static Future<http.Response> post(
    String baseUrl,
    String path,
    Object? body, {
    Duration timeout = const Duration(seconds: 15),
  }) => _send(
    baseUrl,
    () => http
        .post(
          Uri.parse('$baseUrl$path'),
          headers: _headers(),
          body: jsonEncode(body),
        )
        .timeout(timeout),
  );

  static Future<http.Response> put(
    String baseUrl,
    String path,
    Object? body, {
    Duration timeout = const Duration(seconds: 15),
  }) => _send(
    baseUrl,
    () => http
        .put(
          Uri.parse('$baseUrl$path'),
          headers: _headers(),
          body: jsonEncode(body),
        )
        .timeout(timeout),
  );

  /// GET that decodes JSON and converts an authorisation failure into
  /// [NeedsSignIn], so callers can prompt rather than showing a raw 403.
  static Future<dynamic> getJson(
    String baseUrl,
    String path, {
    Duration timeout = const Duration(seconds: 15),
  }) async {
    final resp = await get(baseUrl, path, timeout: timeout);
    if (resp.statusCode == 401 || resp.statusCode == 403) throw NeedsSignIn();
    if (resp.statusCode >= 400) {
      final body = _safeDecode(resp.body);
      throw Exception(body?['error'] ?? 'Request failed (${resp.statusCode})');
    }
    return jsonDecode(resp.body);
  }

  static Map<String, dynamic>? _safeDecode(String body) {
    try {
      final decoded = jsonDecode(body);
      return decoded is Map<String, dynamic> ? decoded : null;
    } catch (_) {
      return null;
    }
  }
}
