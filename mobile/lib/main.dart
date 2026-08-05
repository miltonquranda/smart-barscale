import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_reactive_ble/flutter_reactive_ble.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';

// ─── BLE UUIDs (must match ESP32 firmware) ───
final _svcConfig = Uuid.parse('b4e3a900-5a2b-4f1c-9d7a-000000000001');
final _svcScale = Uuid.parse('b4e3a900-5a2b-4f1c-9d7a-000000000002');

final _charWifiSSID = Uuid.parse('b4e3a901-5a2b-4f1c-9d7a-000000000001');
final _charWifiPass = Uuid.parse('b4e3a902-5a2b-4f1c-9d7a-000000000001');
final _charServerURL = Uuid.parse('b4e3a903-5a2b-4f1c-9d7a-000000000001');
final _charDeviceID = Uuid.parse('b4e3a904-5a2b-4f1c-9d7a-000000000001');
final _charAuthToken = Uuid.parse('b4e3a905-5a2b-4f1c-9d7a-000000000001');
final _charWifiStatus = Uuid.parse('b4e3a906-5a2b-4f1c-9d7a-000000000001');
final _charWifiScan = Uuid.parse('b4e3a907-5a2b-4f1c-9d7a-000000000001');

final _charWeight = Uuid.parse('b4e3a901-5a2b-4f1c-9d7a-000000000002');
final _charBarcode = Uuid.parse('b4e3a902-5a2b-4f1c-9d7a-000000000002');
final _charStatus = Uuid.parse('b4e3a903-5a2b-4f1c-9d7a-000000000002');
final _charCommand = Uuid.parse('b4e3a904-5a2b-4f1c-9d7a-000000000002');

void main() => runApp(const OmniScaleApp());

class OmniScaleApp extends StatelessWidget {
  const OmniScaleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SmartBar',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1565C0),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1565C0),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _ble = FlutterReactiveBle();

  // Connection state
  String? _deviceId;
  String? _deviceName;
  DeviceConnectionState _connState = DeviceConnectionState.disconnected;
  StreamSubscription? _connSub;
  StreamSubscription? _scanSub;
  final List<DiscoveredDevice> _discovered = [];
  bool _scanning = false;

  // Subscriptions for notifications
  StreamSubscription? _weightSub;
  StreamSubscription? _barcodeSub;
  StreamSubscription? _statusSub;
  StreamSubscription? _wifiStatusSub;
  StreamSubscription? _deviceIdSub;
  StreamSubscription? _wifiScanSub;

  // Live data from device
  String _weight = '--';
  String _barcode = '--';
  String _status = 'disconnected';
  String _wifiStatus = 'unknown';
  final List<Map<String, dynamic>> _wifiNetworks = [];
  bool _wifiScanLoading = false;
  VoidCallback? _onWifiScanUpdated;

  // Server config (stored locally in app)
  String _serverUrl = '';

  // Device registration info from backend
  String _deviceSerial = '';
  Map<String, dynamic>? _deviceInfo;
  bool _deviceInfoLoading = false;

  // Product info from backend
  Map<String, dynamic>? _product;
  bool _productLoading = false;
  String? _productError;
  bool _addProductDialogOpen = false;
  final Set<String> _promptedBarcodes = <String>{};

  bool get _connected => _connState == DeviceConnectionState.connected;

  @override
  void initState() {
    super.initState();
    _loadSavedDevice();
  }

  Future<void> _loadSavedDevice() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('last_device_id');
    final name = prefs.getString('last_device_name');
    final url = prefs.getString('server_url') ?? '';
    var serial = prefs.getString('device_serial') ?? '';
    // Discard corrupt cached serials (non-printable chars)
    if (serial.isNotEmpty && !RegExp(r'^[\x20-\x7E]+$').hasMatch(serial)) {
      debugPrint('Discarding corrupt saved serial: "$serial"');
      serial = '';
      prefs.remove('device_serial');
    }
    setState(() {
      if (saved != null) {
        _deviceId = saved;
        _deviceName = name;
      }
      _serverUrl = url;
      _deviceSerial = serial;
    });
  }

  Future<void> _saveDevice(String id, String name) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('last_device_id', id);
    await prefs.setString('last_device_name', name);
  }

  // ─── BLE Scanning ───
  void _startScan() {
    _discovered.clear();
    setState(() => _scanning = true);

    _scanSub?.cancel();
    _scanSub = _ble
        .scanForDevices(
          withServices: [_svcConfig],
          scanMode: ScanMode.lowLatency,
        )
        .listen((device) {
          final idx = _discovered.indexWhere((d) => d.id == device.id);
          setState(() {
            if (idx >= 0) {
              _discovered[idx] = device;
            } else {
              _discovered.add(device);
            }
          });
        }, onError: (_) {});

    Future.delayed(const Duration(seconds: 10), () {
      _scanSub?.cancel();
      if (mounted) setState(() => _scanning = false);
    });
  }

  void _stopScan() {
    _scanSub?.cancel();
    setState(() => _scanning = false);
  }

  // ─── BLE Connection ───
  void _connectDevice(String id, String name) {
    _connSub?.cancel();
    setState(() {
      _deviceId = id;
      _deviceName = name;
      _connState = DeviceConnectionState.connecting;
    });

    _connSub = _ble
        .connectToDevice(id: id, connectionTimeout: const Duration(seconds: 10))
        .listen(
          (state) {
            setState(() => _connState = state.connectionState);
            if (state.connectionState == DeviceConnectionState.connected) {
              _saveDevice(id, name);
              // Extract device serial from BLE name (e.g. "OmniScale-SB_A40FB1215788")
              _extractSerialFromName(name);
              _subscribeNotifications();
              Future.delayed(const Duration(seconds: 1), _readInitialValues);
              if (_deviceSerial.isNotEmpty &&
                  _serverUrl.isNotEmpty &&
                  _deviceInfo == null) {
                _fetchDeviceInfo();
              }
            } else if (state.connectionState ==
                DeviceConnectionState.disconnected) {
              _cancelSubscriptions();
              setState(() {
                _weight = '--';
                _barcode = '--';
                _status = 'disconnected';
                _wifiStatus = 'unknown';
              });
            }
          },
          onError: (_) {
            setState(() => _connState = DeviceConnectionState.disconnected);
          },
        );
  }

  void _disconnect() {
    _connSub?.cancel();
    _cancelSubscriptions();
    setState(() {
      _connState = DeviceConnectionState.disconnected;
      _weight = '--';
      _barcode = '--';
      _status = 'disconnected';
      _wifiStatus = 'unknown';
    });
  }

  void _cancelSubscriptions() {
    _weightSub?.cancel();
    _barcodeSub?.cancel();
    _statusSub?.cancel();
    _wifiStatusSub?.cancel();
    _deviceIdSub?.cancel();
    _wifiScanSub?.cancel();
  }

  // ─── Notifications ───
  void _subscribeNotifications() {
    final id = _deviceId!;

    _weightSub = _ble
        .subscribeToCharacteristic(
          QualifiedCharacteristic(
            characteristicId: _charWeight,
            serviceId: _svcScale,
            deviceId: id,
          ),
        )
        .listen((data) {
          if (data.isNotEmpty) setState(() => _weight = utf8.decode(data));
        });

    _barcodeSub = _ble
        .subscribeToCharacteristic(
          QualifiedCharacteristic(
            characteristicId: _charBarcode,
            serviceId: _svcScale,
            deviceId: id,
          ),
        )
        .listen((data) {
          if (data.isNotEmpty) {
            final code = utf8.decode(data);
            if (code != _barcode && code != '--') {
              setState(() => _barcode = code);
              _fetchProduct(code);
            }
          }
        });

    _statusSub = _ble
        .subscribeToCharacteristic(
          QualifiedCharacteristic(
            characteristicId: _charStatus,
            serviceId: _svcScale,
            deviceId: id,
          ),
        )
        .listen((data) {
          if (data.isNotEmpty) setState(() => _status = utf8.decode(data));
        });

    _wifiStatusSub = _ble
        .subscribeToCharacteristic(
          QualifiedCharacteristic(
            characteristicId: _charWifiStatus,
            serviceId: _svcConfig,
            deviceId: id,
          ),
        )
        .listen((data) {
          if (data.isEmpty) return;
          final message = _sanitizeBleString(data);
          if (!_handleWifiScanMessage(message))
            setState(() => _wifiStatus = message);
        });

    _deviceIdSub = _ble
        .subscribeToCharacteristic(
          QualifiedCharacteristic(
            characteristicId: _charDeviceID,
            serviceId: _svcConfig,
            deviceId: id,
          ),
        )
        .listen((data) {
          if (data.isNotEmpty) {
            final serial = _sanitizeBleString(data);
            if (serial.startsWith('WIFI:')) {
              _handleWifiScanMessage(serial.substring(5));
              return;
            }
            debugPrint(
              'BLE deviceID notification: "$serial" (raw ${data.length} bytes)',
            );
            if (serial.length >= 3 && serial != _deviceSerial) {
              SharedPreferences.getInstance().then((prefs) {
                prefs.setString('device_serial', serial);
              });
              setState(() => _deviceSerial = serial);
              if (_serverUrl.isNotEmpty) _fetchDeviceInfo();
            }
          }
        });

    _wifiScanSub = _ble
        .subscribeToCharacteristic(
          QualifiedCharacteristic(
            characteristicId: _charWifiScan,
            serviceId: _svcConfig,
            deviceId: id,
          ),
        )
        .listen((data) {
          _handleWifiScanMessage(_sanitizeBleString(data));
        });
  }

  bool _handleWifiScanMessage(String message) {
    if (message == 'SCAN_BEGIN') {
      setState(() {
        _wifiNetworks.clear();
        _wifiScanLoading = true;
      });
      _onWifiScanUpdated?.call();
      return true;
    } else if (message == 'SCAN_END' || message == 'SCAN_ERROR') {
      setState(() => _wifiScanLoading = false);
      _onWifiScanUpdated?.call();
      return true;
    } else if (message.contains('|')) {
      final parts = message.split('|');
      if (parts.length >= 3 && parts[0].isNotEmpty) {
        final network = <String, dynamic>{
          'ssid': parts[0],
          'rssi': int.tryParse(parts[1]) ?? -100,
          'secure': parts[2] == '1',
        };
        final idx = _wifiNetworks.indexWhere(
          (n) => n['ssid'] == network['ssid'],
        );
        if (idx >= 0) {
          _wifiNetworks[idx] = network;
        } else {
          _wifiNetworks.add(network);
        }
        setState(() {});
        _onWifiScanUpdated?.call();
      }
      return true;
    }
    return false;
  }

  Future<void> _readInitialValues() async {
    if (!_connected || _deviceId == null) return;
    final id = _deviceId!;
    try {
      final ws = await _ble.readCharacteristic(
        QualifiedCharacteristic(
          characteristicId: _charWifiStatus,
          serviceId: _svcConfig,
          deviceId: id,
        ),
      );
      debugPrint(
        'BLE read wifiStatus: ${ws.length} bytes = ${ws.isNotEmpty ? utf8.decode(ws) : "empty"}',
      );
      if (ws.isNotEmpty) setState(() => _wifiStatus = utf8.decode(ws));
    } catch (e) {
      debugPrint('BLE read wifiStatus error: $e');
    }
    try {
      final st = await _ble.readCharacteristic(
        QualifiedCharacteristic(
          characteristicId: _charStatus,
          serviceId: _svcScale,
          deviceId: id,
        ),
      );
      debugPrint(
        'BLE read status: ${st.length} bytes = ${st.isNotEmpty ? utf8.decode(st) : "empty"}',
      );
      if (st.isNotEmpty) setState(() => _status = utf8.decode(st));
    } catch (e) {
      debugPrint('BLE read status error: $e');
    }
    // Read device serial and server URL, then fetch business info from backend
    await _readDeviceConfig();
    // Retry once after a delay if serial was empty (ESP32 onRead may need time)
    if (_deviceSerial.isEmpty) {
      await Future.delayed(const Duration(seconds: 2));
      if (_connected) await _readDeviceConfig();
    }
  }

  /// Extract device serial from BLE advertised name (e.g. "OmniScale-SB_A40FB1215788").
  void _extractSerialFromName(String name) {
    final idx = name.indexOf('-');
    if (idx >= 0 && idx < name.length - 1) {
      final serial = name.substring(idx + 1);
      if (serial.length >= 5) {
        debugPrint('Extracted serial from BLE name: "$serial"');
        SharedPreferences.getInstance().then((prefs) {
          prefs.setString('device_serial', serial);
        });
        setState(() => _deviceSerial = serial);
      }
    }
  }

  /// Sanitize BLE string: decode bytes, strip non-printable chars and nulls.
  String _sanitizeBleString(List<int> raw) {
    if (raw.isEmpty) return '';
    final decoded = utf8.decode(raw, allowMalformed: true);
    // Keep only printable ASCII (space through tilde)
    return decoded
        .replaceAll(RegExp(r'[^\x20-\x7E]'), '')
        .replaceAll('\uFFFD', '')
        .trim();
  }

  Future<void> _readDeviceConfig() async {
    if (!_connected || _deviceId == null) return;
    final id = _deviceId!;

    // Read device serial via BLE only if we don't already have it from the name
    if (_deviceSerial.isEmpty) {
      try {
        final data = await _ble.readCharacteristic(
          QualifiedCharacteristic(
            characteristicId: _charDeviceID,
            serviceId: _svcConfig,
            deviceId: id,
          ),
        );
        debugPrint('BLE raw deviceID: ${data.length} bytes = $data');
        final serial = _sanitizeBleString(data);
        debugPrint('BLE device serial sanitized: "$serial"');
        if (serial.length >= 5) {
          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('device_serial', serial);
          if (mounted) setState(() => _deviceSerial = serial);
        }
      } catch (e) {
        debugPrint('BLE read deviceID FAILED: $e');
      }
    }

    // Read server URL
    try {
      final data = await _ble.readCharacteristic(
        QualifiedCharacteristic(
          characteristicId: _charServerURL,
          serviceId: _svcConfig,
          deviceId: id,
        ),
      );
      final url = _sanitizeBleString(data);
      debugPrint('BLE server URL sanitized: "$url"');
      if (url.isNotEmpty && _serverUrl.isEmpty) {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('server_url', url);
        if (mounted) setState(() => _serverUrl = url);
      }
    } catch (e) {
      debugPrint('BLE read serverURL FAILED: $e');
    }

    if (_deviceSerial.isNotEmpty && _serverUrl.isNotEmpty) {
      _fetchDeviceInfo();
    }
  }

  String? _getServerBaseUrl() {
    var url = _serverUrl.trim();
    if (url.isEmpty) return null;

    // Strip non-printable or corrupt bytes that sometimes leak over BLE
    url = url.replaceAll(RegExp(r'[^\x20-\x7E]'), '');

    // Sometimes the `\uFFFD` unicode replacement character slips through when utf8 decoding corrupt bytes
    url = url.replaceAll('\uFFFD', '');

    url = url.replaceAll(RegExp(r'/+$'), '');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://$url';
    }
    return url;
  }

  // ─── Device info from backend ───
  Future<void> _fetchDeviceInfo() async {
    if (_deviceSerial.isEmpty) return;
    final base = _getServerBaseUrl();
    if (base == null) {
      debugPrint('fetchDeviceInfo: serverUrl is empty, skipping');
      return;
    }
    setState(() => _deviceInfoLoading = true);
    try {
      final uri = Uri.parse('$base/api/device/serial/$_deviceSerial');
      debugPrint('Fetching device info: $uri');
      final resp = await http.get(uri).timeout(const Duration(seconds: 10));
      debugPrint('Device info response: ${resp.statusCode}');
      if (!mounted) return;
      if (resp.statusCode == 200) {
        setState(() {
          _deviceInfo = jsonDecode(resp.body) as Map<String, dynamic>;
          _deviceInfoLoading = false;
        });
      } else {
        debugPrint('Device info error body: ${resp.body}');
        setState(() {
          _deviceInfo = null;
          _deviceInfoLoading = false;
        });
      }
    } catch (e) {
      debugPrint('Device info fetch error: $e');
      if (mounted) setState(() => _deviceInfoLoading = false);
    }
  }

  Future<void> _assignBusiness(String businessId) async {
    if (_deviceSerial.isEmpty) return;
    final base = _getServerBaseUrl();
    if (base == null) return;
    try {
      final uri = Uri.parse('$base/api/device/serial/$_deviceSerial/assign');
      final resp = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'businessId': businessId}),
          )
          .timeout(const Duration(seconds: 10));
      if (!mounted) return;
      if (resp.statusCode == 200) {
        _fetchDeviceInfo();
      } else {
        final err = jsonDecode(resp.body);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err['error'] ?? 'Assignment failed')),
        );
      }
    } catch (e) {
      debugPrint('Assign business error: $e');
    }
  }

  Future<List<Map<String, dynamic>>> _fetchBusinesses() async {
    final base = _getServerBaseUrl();
    if (base == null) return [];
    try {
      final uri = Uri.parse('$base/api/businesses');
      final resp = await http.get(uri).timeout(const Duration(seconds: 10));
      if (resp.statusCode == 200) {
        return (jsonDecode(resp.body) as List).cast<Map<String, dynamic>>();
      }
    } catch (e) {
      debugPrint('Fetch businesses error: $e');
    }
    return [];
  }

  // ─── BLE Write helpers ───
  Future<void> _writeChar(Uuid service, Uuid char, String value) async {
    if (!_connected || _deviceId == null) return;
    await _ble.writeCharacteristicWithResponse(
      QualifiedCharacteristic(
        characteristicId: char,
        serviceId: service,
        deviceId: _deviceId!,
      ),
      value: utf8.encode(value),
    );
  }

  Future<String> _readChar(Uuid service, Uuid char) async {
    if (!_connected || _deviceId == null) return '';
    final data = await _ble.readCharacteristic(
      QualifiedCharacteristic(
        characteristicId: char,
        serviceId: service,
        deviceId: _deviceId!,
      ),
    );
    return data.isNotEmpty ? _sanitizeBleString(data) : '';
  }

  // ─── Product Lookup (via backend API) ───

  Future<void> _fetchProduct(String barcode) async {
    if (barcode.isEmpty || barcode == '--') return;
    // Search the SmartBar catalog only. External barcode enrichment remains
    // disabled so a scan can never be matched to a guessed product.
    setState(() {
      _product = null;
      _productError = null;
      _productLoading = true;
    });

    final baseUrl = _getServerBaseUrl();
    if (baseUrl == null) {
      if (!mounted) return;
      setState(() {
        _productError = 'Server URL not configured';
        _productLoading = false;
      });
      return;
    }

    try {
      final uri = Uri.parse('$baseUrl/api/product/$barcode');
      debugPrint('Product lookup: $uri');
      final resp = await http.get(uri).timeout(const Duration(seconds: 25));

      if (!mounted) return;
      if (resp.statusCode == 200) {
        final data = jsonDecode(resp.body) as Map<String, dynamic>;
        setState(() {
          _product = {
            'product_name': data['name'],
            'brand': data['brand'],
            'description': data['description'],
            'category': data['category'],
            'category_name': data['category_name'],
            'image_url': data['image_url'],
            'quantity': data['quantity'],
            'weight': data['weight'],
            'pour_price': data['pour_price'],
            'pour_volume_ml': data['pour_volume_ml'],
            'country_of_origin': data['country_of_origin'],
            'ingredients': data['ingredients'],
            'nutrition_per_100': data['nutrition_per_100'],
            'source': data['source'],
          };
          _productLoading = false;
        });
      } else {
        setState(() {
          _productError = 'Product not found';
          _productLoading = false;
        });
        // Prompt immediately for an unknown barcode; the error card remains
        // available as a retry path if the user dismisses the form.
        if (mounted &&
            !_addProductDialogOpen &&
            !_promptedBarcodes.contains(barcode)) {
          _promptedBarcodes.add(barcode);
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && !_addProductDialogOpen && _barcode == barcode) {
              _showAddProductDialog(barcode);
            }
          });
        }
      }
    } catch (e) {
      debugPrint('Product lookup error: $e');
      if (!mounted) return;
      setState(() {
        _productError = 'Lookup failed: ${e.toString().split(':').last.trim()}';
        _productLoading = false;
      });
    }
  }

  // ─── Add / Edit Product ───
  final _picker = ImagePicker();

  Future<void> _submitProduct(String barcode, Map<String, dynamic> data) async {
    final baseUrl = _getServerBaseUrl();
    if (baseUrl == null) return;

    try {
      final uri = Uri.parse('$baseUrl/api/product/$barcode');
      final resp = await http
          .put(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode(data),
          )
          .timeout(const Duration(seconds: 15));

      if (!mounted) return;
      if (resp.statusCode == 200 || resp.statusCode == 201) {
        debugPrint('Product save response: ${resp.statusCode} ${resp.body}');
        final saved = jsonDecode(resp.body) as Map<String, dynamic>;
        setState(() {
          _product = {
            'product_name': saved['name'],
            'brand': saved['brand'],
            'description': saved['description'],
            'category': saved['category'],
            'category_name': saved['category_name'],
            'image_url': saved['image_url'],
            'quantity': saved['quantity'],
            'weight': saved['weight'],
            'pour_price': saved['pour_price'],
            'pour_volume_ml': saved['pour_volume_ml'],
            'country_of_origin': saved['country_of_origin'],
            'ingredients': saved['ingredients'],
            'nutrition_per_100': saved['nutrition_per_100'],
            'source': saved['source'],
          };
          _productError = null;
          _productLoading = false;
        });
        _promptedBarcodes.remove(barcode);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Product saved successfully')),
        );
      } else {
        debugPrint('Product save failed: ${resp.statusCode} ${resp.body}');
        final err = jsonDecode(resp.body)['error'] ?? 'Unknown error';
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed to save: $err')));
      }
    } catch (e) {
      debugPrint('Product save error: $e');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Error: ${e.toString().split(':').last.trim()}'),
        ),
      );
    }
  }

  Future<String?> _uploadImage(String barcode, File file) async {
    final baseUrl = _getServerBaseUrl();
    if (baseUrl == null) return null;

    final bytes = await file.readAsBytes();
    final b64 = base64Encode(bytes);
    final ext = file.path.toLowerCase();
    final mime = ext.endsWith('.png') ? 'image/png' : 'image/jpeg';

    try {
      final uri = Uri.parse('$baseUrl/api/product/$barcode/image');
      final resp = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'image': b64, 'contentType': mime}),
          )
          .timeout(const Duration(seconds: 30));

      if (resp.statusCode == 200) {
        final url = jsonDecode(resp.body)['image_url'] as String?;
        return url;
      }
    } catch (e) {
      debugPrint('Image upload error: $e');
    }
    return null;
  }

  void _showAddProductDialog(String barcode) {
    if (_addProductDialogOpen) return;
    _addProductDialogOpen = true;
    final nameCtrl = TextEditingController();
    final brandCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    final categoryCtrl = TextEditingController();
    final categoryIdCtrl = TextEditingController();
    final imageCtrl = TextEditingController();
    final quantityCtrl = TextEditingController();
    final weightCtrl = TextEditingController();
    final pourPriceCtrl = TextEditingController();
    final pourVolumeCtrl = TextEditingController();
    final originCtrl = TextEditingController();
    final ingredientsCtrl = TextEditingController();

    if (_product != null) {
      nameCtrl.text = _product!['product_name'] ?? '';
      brandCtrl.text = _product!['brand'] ?? '';
      descCtrl.text = _product!['description'] ?? '';
      categoryIdCtrl.text = (_product!['category'] ?? '').toString();
      categoryCtrl.text =
          (_product!['category_name'] ?? _product!['category'] ?? '')
              .toString();
      imageCtrl.text = _product!['image_url'] ?? '';
      quantityCtrl.text = _product!['quantity'] ?? '';
      weightCtrl.text = _product!['weight'] ?? '';
      pourPriceCtrl.text = (_product!['pour_price'] ?? '').toString();
      pourVolumeCtrl.text = (_product!['pour_volume_ml'] ?? '').toString();
      originCtrl.text = _product!['country_of_origin'] ?? '';
      ingredientsCtrl.text = _product!['ingredients'] ?? '';
    }

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return _ProductForm(
          barcode: barcode,
          isEditing: _product != null,
          nameCtrl: nameCtrl,
          brandCtrl: brandCtrl,
          descCtrl: descCtrl,
          categoryCtrl: categoryCtrl,
          categoryIdCtrl: categoryIdCtrl,
          imageCtrl: imageCtrl,
          quantityCtrl: quantityCtrl,
          weightCtrl: weightCtrl,
          pourPriceCtrl: pourPriceCtrl,
          pourVolumeCtrl: pourVolumeCtrl,
          originCtrl: originCtrl,
          ingredientsCtrl: ingredientsCtrl,
          getServerBaseUrl: _getServerBaseUrl,
          onPickImage: (source) async {
            final picked = await _picker.pickImage(
              source: source,
              maxWidth: 1024,
              imageQuality: 80,
            );
            if (picked == null) return null;
            return File(picked.path);
          },
          onUploadImage: (file) => _uploadImage(barcode, file),
          onSave: (data) {
            Navigator.pop(ctx);
            _submitProduct(barcode, data);
          },
        );
      },
    ).whenComplete(() => _addProductDialogOpen = false);
  }

  Widget _field(String label, TextEditingController ctrl, {int maxLines = 1}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: ctrl,
        maxLines: maxLines,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 10,
          ),
          isDense: true,
        ),
      ),
    );
  }

  // ─── Commands ───
  Future<void> _sendTare() => _writeChar(_svcScale, _charCommand, 'tare');

  Future<void> _openCalibrationDialog() async {
    final refCtrl = TextEditingController();
    await showDialog<void>(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Calibrate scale'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Remove all items, tare the scale, then place a known reference weight on it.',
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: refCtrl,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(
                    labelText: 'Reference weight (grams)',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () {
                  final grams = double.tryParse(refCtrl.text.trim());
                  if (grams == null || grams <= 0) return;
                  Navigator.pop(ctx);
                  _writeChar(
                    _svcScale,
                    _charCommand,
                    'calibrate:${grams.toString()}',
                  );
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text(
                        'Calibration sent. Leave the reference weight in place until complete.',
                      ),
                    ),
                  );
                },
                child: const Text('Calibrate'),
              ),
            ],
          ),
    );
    refCtrl.dispose();
  }

  @override
  void dispose() {
    _scanSub?.cancel();
    _connSub?.cancel();
    _cancelSubscriptions();
    super.dispose();
  }

  // ─── UI ───
  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(_deviceName ?? 'SmartBar'),
        actions: [
          if (_connected) ...[
            IconButton(
              icon: const Icon(Icons.wifi),
              tooltip: 'WiFi Setup',
              onPressed: () => _openWiFiSettings(),
            ),
            IconButton(
              icon: const Icon(Icons.settings),
              tooltip: 'Device Config',
              onPressed: () => _showConfigDialog(),
            ),
            IconButton(
              icon: const Icon(Icons.bluetooth_disabled),
              tooltip: 'Disconnect',
              onPressed: _disconnect,
            ),
          ] else ...[
            IconButton(
              icon: const Icon(Icons.bluetooth_searching),
              tooltip: 'Connect',
              onPressed: () => _showScanDialog(),
            ),
          ],
        ],
      ),
      body: _connected ? _buildMonitor(cs) : _buildDisconnected(cs),
    );
  }

  Widget _buildDisconnected(ColorScheme cs) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.bluetooth_disabled, size: 80, color: cs.outline),
            const SizedBox(height: 24),
            Text(
              'Not Connected',
              style: TextStyle(fontSize: 20, color: cs.onSurface),
            ),
            const SizedBox(height: 8),
            Text(
              _deviceName != null
                  ? 'Last device: $_deviceName'
                  : 'Tap below to find your OmniScale',
              style: TextStyle(color: cs.outline),
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: () {
                if (_deviceId != null) {
                  _connectDevice(_deviceId!, _deviceName ?? 'OmniScale');
                } else {
                  _showScanDialog();
                }
              },
              icon: const Icon(Icons.bluetooth),
              label: Text(_deviceId != null ? 'Reconnect' : 'Scan for Devices'),
            ),
            if (_deviceId != null) ...[
              const SizedBox(height: 12),
              TextButton(
                onPressed: () => _showScanDialog(),
                child: const Text('Scan for different device'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildMonitor(ColorScheme cs) {
    final isError = _status.startsWith('error:');
    final statusColor =
        isError
            ? cs.error
            : _status == 'success'
            ? Colors.green
            : cs.primary;
    final statusText = isError ? _status.substring(6) : _status;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Status chip
          Center(
            child: Chip(
              avatar: Icon(
                isError ? Icons.error : Icons.circle,
                color: statusColor,
                size: 16,
              ),
              label: Text(
                statusText.toUpperCase(),
                style: TextStyle(
                  color: statusColor,
                  fontWeight: FontWeight.w600,
                ),
              ),
              backgroundColor: statusColor.withAlpha(25),
              side: BorderSide(color: statusColor.withAlpha(80)),
            ),
          ),
          const SizedBox(height: 24),

          // Weight display
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 16),
              child: Column(
                children: [
                  Text(
                    'WEIGHT',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: cs.outline,
                      letterSpacing: 1.5,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _weight == '--' ? '--' : '$_weight g',
                    style: TextStyle(
                      fontSize: 56,
                      fontWeight: FontWeight.bold,
                      color: cs.onSurface,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Barcode display
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  Icon(Icons.qr_code_scanner, color: cs.primary, size: 32),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'BARCODE',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: cs.outline,
                            letterSpacing: 1.2,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _barcode,
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w500,
                            color: cs.onSurface,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Product info
          _buildProductCard(cs),
          const SizedBox(height: 12),

          // WiFi status
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(
                    _wifiStatus.startsWith('connected')
                        ? Icons.wifi
                        : Icons.wifi_off,
                    color:
                        _wifiStatus.startsWith('connected')
                            ? Colors.green
                            : cs.error,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      _wifiStatus.startsWith('connected')
                          ? 'WiFi: ${_wifiStatus.split(':').last}'
                          : 'WiFi: Disconnected',
                      style: TextStyle(color: cs.onSurface),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Device & Business info
          _buildDeviceInfoCard(cs),
          const SizedBox(height: 24),

          // Tare button
          FilledButton.icon(
            onPressed: _sendTare,
            icon: const Icon(Icons.refresh),
            label: const Text('TARE'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _openCalibrationDialog,
            icon: const Icon(Icons.tune),
            label: const Text('CALIBRATE'),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
              minimumSize: const Size.fromHeight(48),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDeviceInfoCard(ColorScheme cs) {
    if (_deviceSerial.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.devices, color: cs.outline),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Device serial not detected. Tap config (gear icon) to enter it manually.',
                      style: TextStyle(fontSize: 13, color: cs.outline),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              TextButton.icon(
                icon: const Icon(Icons.refresh, size: 16),
                label: const Text('Retry reading from device'),
                onPressed:
                    _connected
                        ? () async {
                          await _readDeviceConfig();
                          if (mounted && _deviceSerial.isEmpty) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                  'Still could not read device serial from BLE. Check debug console.',
                                ),
                              ),
                            );
                          }
                        }
                        : null,
              ),
            ],
          ),
        ),
      );
    }

    if (_deviceInfoLoading) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 12),
              Text(
                'Loading device info...',
                style: TextStyle(color: cs.onSurface),
              ),
            ],
          ),
        ),
      );
    }

    final business = _deviceInfo?['business'];
    final hasBusinessObject = business is Map && business['name'] != null;
    final noServer = _serverUrl.isEmpty;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.devices, color: cs.primary),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'DEVICE',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: cs.outline,
                          letterSpacing: 1.2,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _deviceSerial,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                          color: cs.onSurface,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.refresh, size: 20),
                  onPressed: _fetchDeviceInfo,
                  tooltip: 'Refresh',
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (noServer)
              Row(
                children: [
                  Icon(Icons.warning_amber, color: cs.outline, size: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Set Server URL in config to see business info',
                      style: TextStyle(fontSize: 13, color: cs.outline),
                    ),
                  ),
                ],
              )
            else
              Row(
                children: [
                  Icon(
                    Icons.business,
                    color: hasBusinessObject ? Colors.green : cs.outline,
                    size: 20,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child:
                        hasBusinessObject
                            ? Text(
                              business['name'] +
                                  (business['zipCode'] != null
                                      ? ' (${business['zipCode']})'
                                      : ''),
                              style: TextStyle(
                                fontSize: 14,
                                color: cs.onSurface,
                                fontWeight: FontWeight.w500,
                              ),
                            )
                            : Text(
                              'No business assigned',
                              style: TextStyle(fontSize: 14, color: cs.outline),
                            ),
                  ),
                  if (!hasBusinessObject && !noServer)
                    FilledButton.tonal(
                      onPressed: _showAssignBusinessDialog,
                      child: const Text('Assign'),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  void _showAssignBusinessDialog() async {
    final businesses = await _fetchBusinesses();
    if (!mounted || businesses.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'No businesses found. Create one from the web admin.',
            ),
          ),
        );
      }
      return;
    }

    String? selected;
    showDialog(
      context: context,
      builder:
          (ctx) => StatefulBuilder(
            builder:
                (ctx, setDialogState) => AlertDialog(
                  title: const Text('Assign to Business'),
                  content: DropdownButtonFormField<String>(
                    value: selected,
                    decoration: const InputDecoration(
                      labelText: 'Select Business',
                      prefixIcon: Icon(Icons.business),
                    ),
                    items:
                        businesses
                            .map(
                              (b) => DropdownMenuItem<String>(
                                value: b['_id'] as String,
                                child: Text(
                                  '${b['name']}${b['zipCode'] != null ? ' (${b['zipCode']})' : ''}',
                                ),
                              ),
                            )
                            .toList(),
                    onChanged: (v) => setDialogState(() => selected = v),
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      child: const Text('Cancel'),
                    ),
                    FilledButton(
                      onPressed:
                          selected == null
                              ? null
                              : () {
                                Navigator.pop(ctx);
                                _assignBusiness(selected!);
                              },
                      child: const Text('Assign'),
                    ),
                  ],
                ),
          ),
    );
  }

  Widget _buildProductCard(ColorScheme cs) {
    if (_productLoading) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircularProgressIndicator(),
                SizedBox(height: 12),
                Text('Looking up product...', style: TextStyle(fontSize: 13)),
              ],
            ),
          ),
        ),
      );
    }
    if (_productError != null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.info_outline, color: cs.outline),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      _productError!,
                      style: TextStyle(color: cs.outline),
                    ),
                  ),
                ],
              ),
              if (_productError == 'Product not found' && _barcode != '--')
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      icon: const Icon(Icons.add, size: 18),
                      label: const Text('Add Product Info'),
                      onPressed: () => _showAddProductDialog(_barcode),
                    ),
                  ),
                ),
            ],
          ),
        ),
      );
    }
    if (_product == null) return const SizedBox.shrink();

    final p = _product!;
    final name = p['product_name'] as String?;
    final brand = p['brand'] as String?;
    final description = p['description'] as String?;
    final quantity = p['quantity'] as String?;
    final productWeight = p['weight'] as String?;
    final pourPrice = p['pour_price'];
    final pourVolume = p['pour_volume_ml'];
    final imageUrl = p['image_url'] as String?;
    final category = p['category'] as String?;
    final categoryName = p['category_name'] as String?;
    final ingredients = p['ingredients'] as String?;
    final origin = p['country_of_origin'] as String?;
    final nutrition = p['nutrition_per_100'] as Map<String, dynamic>?;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Product image (full-width if available)
          if (imageUrl != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.network(
                    imageUrl,
                    height: 180,
                    fit: BoxFit.contain,
                    errorBuilder:
                        (_, __, ___) => Container(
                          height: 120,
                          decoration: BoxDecoration(
                            color: cs.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Center(
                            child: Icon(
                              Icons.image_not_supported,
                              color: cs.outline,
                              size: 40,
                            ),
                          ),
                        ),
                  ),
                ),
              ),
            ),

          // Name, brand, quantity
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      'PRODUCT INFO',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: cs.outline,
                        letterSpacing: 1.2,
                      ),
                    ),
                    const Spacer(),
                    if (_barcode != '--')
                      GestureDetector(
                        onTap: () => _showAddProductDialog(_barcode),
                        child: Icon(Icons.edit, size: 18, color: cs.outline),
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                if (name != null && name.isNotEmpty)
                  Text(
                    name,
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                      color: cs.onSurface,
                    ),
                  ),
                if (brand != null && brand.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      brand,
                      style: TextStyle(
                        fontSize: 14,
                        color: cs.primary,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                if (description != null && description.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      description,
                      style: TextStyle(
                        fontSize: 13,
                        color: cs.onSurfaceVariant,
                      ),
                    ),
                  ),
                const SizedBox(height: 12),
                _buildDetailRow(
                  Icons.category,
                  'Category',
                  categoryName ?? category,
                  cs,
                ),
                _buildDetailRow(
                  Icons.fitness_center,
                  'Weight',
                  productWeight,
                  cs,
                ),
                _buildDetailRow(Icons.straighten, 'Quantity', quantity, cs),
                _buildDetailRow(
                  Icons.local_bar,
                  'Price per pour',
                  pourPrice == null ? null : '\$${pourPrice}',
                  cs,
                ),
                _buildDetailRow(
                  Icons.water_drop,
                  'Pour size',
                  pourVolume == null ? null : '${pourVolume} ml',
                  cs,
                ),
                _buildDetailRow(Icons.public, 'Origin', origin, cs),
              ],
            ),
          ),

          // Ingredients
          if (ingredients != null && ingredients.isNotEmpty) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'INGREDIENTS',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: cs.outline,
                      letterSpacing: 1.0,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    ingredients,
                    style: TextStyle(
                      fontSize: 13,
                      color: cs.onSurfaceVariant,
                      height: 1.4,
                    ),
                  ),
                ],
              ),
            ),
          ],

          // Nutrition table
          if (nutrition != null && nutrition.isNotEmpty) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'NUTRITION (per 100g/ml)',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: cs.outline,
                      letterSpacing: 1.0,
                    ),
                  ),
                  const SizedBox(height: 8),
                  _buildNutritionTable(nutrition, cs),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildDetailRow(
    IconData icon,
    String label,
    String? value,
    ColorScheme cs,
  ) {
    if (value == null || value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(icon, size: 18, color: cs.primary),
          const SizedBox(width: 10),
          Text(
            '$label:',
            style: TextStyle(
              fontSize: 13,
              color: cs.outline,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 13,
                color: cs.onSurface,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNutritionTable(Map<String, dynamic> n, ColorScheme cs) {
    Widget row(String label, dynamic val, String unit) {
      if (val == null) return const SizedBox.shrink();
      final display =
          val is num ? '${val.toStringAsFixed(1)} $unit' : '$val $unit';
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label, style: TextStyle(fontSize: 13, color: cs.onSurface)),
            Text(
              display,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: cs.onSurface,
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      children: [
        row('Energy', n['energy_kj'], 'kJ'),
        row('Fat', n['fat_g'], 'g'),
        row('Saturated fat', n['saturated_fat_g'], 'g'),
        row('Carbohydrates', n['carbohydrates_g'], 'g'),
        row('Sugars', n['sugars_g'], 'g'),
        row('Proteins', n['proteins_g'], 'g'),
        row('Salt', n['salt_g'], 'g'),
        row('Fiber', n['fiber_g'], 'g'),
      ],
    );
  }

  // ─── Dialogs ───
  void _showScanDialog() {
    _startScan();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder:
          (ctx) => StatefulBuilder(
            builder: (ctx, setSheetState) {
              _scanSub?.onData((device) {
                final idx = _discovered.indexWhere((d) => d.id == device.id);
                setSheetState(() {
                  if (idx >= 0) {
                    _discovered[idx] = device;
                  } else {
                    _discovered.add(device);
                  }
                });
                setState(() {});
              });

              return DraggableScrollableSheet(
                initialChildSize: 0.5,
                minChildSize: 0.3,
                maxChildSize: 0.8,
                expand: false,
                builder:
                    (_, scrollCtrl) => Column(
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            children: [
                              const Text(
                                'Scanning...',
                                style: TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const Spacer(),
                              if (_scanning)
                                const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        Expanded(
                          child:
                              _discovered.isEmpty
                                  ? const Center(
                                    child: Text(
                                      'Looking for OmniScale devices...',
                                    ),
                                  )
                                  : ListView.builder(
                                    controller: scrollCtrl,
                                    itemCount: _discovered.length,
                                    itemBuilder: (_, i) {
                                      final d = _discovered[i];
                                      final name =
                                          d.name.isNotEmpty
                                              ? d.name
                                              : 'Unknown';
                                      return ListTile(
                                        leading: const Icon(Icons.bluetooth),
                                        title: Text(name),
                                        subtitle: Text(d.id),
                                        trailing: Text('${d.rssi} dBm'),
                                        onTap: () {
                                          _stopScan();
                                          Navigator.pop(ctx);
                                          _connectDevice(d.id, name);
                                        },
                                      );
                                    },
                                  ),
                        ),
                      ],
                    ),
              );
            },
          ),
    ).whenComplete(_stopScan);
  }

  Future<void> _startWifiScan() async {
    if (!_connected) return;
    setState(() {
      _wifiNetworks.clear();
      _wifiScanLoading = true;
    });
    _onWifiScanUpdated?.call();

    try {
      await _writeChar(_svcConfig, _charWifiScan, 'scan');
      // Wait 7 seconds for ESP32 hardware scan (~4s) and BLE notifications (~3s) to finish
      await Future.delayed(const Duration(seconds: 7));
      await _readWifiScanResults();
    } catch (e) {
      debugPrint('Error starting Wi-Fi scan: $e');
    } finally {
      if (mounted) {
        setState(() => _wifiScanLoading = false);
        _onWifiScanUpdated?.call();
      }
    }
  }

  void _openWiFiSettings() async {
    String currentSSID = '';
    try {
      currentSSID = await _readChar(_svcConfig, _charWifiSSID);
    } catch (_) {}

    if (!mounted) return;

    if (_wifiNetworks.isEmpty && !_wifiScanLoading && _connected) {
      _startWifiScan();
    }

    Navigator.push(
      context,
      MaterialPageRoute(
        builder:
            (context) => WifiSettingsScreen(
              connected: _connected,
              currentSSID: currentSSID,
              wifiStatus: _wifiStatus,
              wifiNetworks: _wifiNetworks,
              getIsLoading: () => _wifiScanLoading,
              onScanRequested: _startWifiScan,
              onConnect: (ssid, pass) async {
                await _writeChar(_svcConfig, _charWifiSSID, ssid);
                await _writeChar(_svcConfig, _charWifiPass, pass);
              },
              registerUpdateListener: (listener) {
                _onWifiScanUpdated = listener;
              },
              unregisterUpdateListener: () {
                _onWifiScanUpdated = null;
              },
            ),
      ),
    );
  }

  Future<void> _readWifiScanResults() async {
    if (!_connected) return;
    try {
      await _writeChar(
        _svcConfig,
        _charWifiScan,
        'get:all',
      ).timeout(const Duration(seconds: 3));
      await Future.delayed(const Duration(milliseconds: 150));
      final payload = await _readChar(
        _svcConfig,
        _charWifiScan,
      ).timeout(const Duration(seconds: 3));
      debugPrint('WiFi scan read all: ${payload.length} bytes');
      for (final line in payload.split(RegExp(r'[\r\n]+'))) {
        if (!line.contains('|')) continue;
        final parts = line.split('|');
        if (parts.length >= 3 && parts[0].trim().isNotEmpty) {
          final network = <String, dynamic>{
            'ssid': parts[0].trim(),
            'rssi': int.tryParse(parts[1]) ?? -100,
            'secure': parts[2].trim() == '1',
          };
          final idx = _wifiNetworks.indexWhere(
            (n) => n['ssid'] == network['ssid'],
          );
          if (idx >= 0) {
            _wifiNetworks[idx] = network;
          } else {
            _wifiNetworks.add(network);
          }
        }
      }
      debugPrint('WiFi networks after merge: ${_wifiNetworks.length}');
    } catch (e) {
      debugPrint('WiFi scan readback error: $e');
    }
    if (mounted) {
      setState(() => _wifiScanLoading = false);
      _onWifiScanUpdated?.call();
    }
  }

  void _showConfigDialog() async {
    final urlCtrl = TextEditingController(text: _serverUrl);
    final idCtrl = TextEditingController(text: _deviceSerial);
    final authCtrl = TextEditingController();

    // Try reading device ID from BLE if connected and we don't have it yet
    if (_connected && idCtrl.text.isEmpty) {
      try {
        final bleId = await _readChar(_svcConfig, _charDeviceID);
        if (bleId.isNotEmpty) idCtrl.text = bleId;
      } catch (_) {}
    }

    if (!mounted) return;
    showDialog(
      context: context,
      builder:
          (ctx) => AlertDialog(
            title: const Text('Device Config'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: urlCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Server URL',
                      prefixIcon: Icon(Icons.cloud),
                      hintText: 'https://api.example.com',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: idCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Device Serial',
                      prefixIcon: Icon(Icons.perm_device_information),
                      hintText: 'SB_XXXXXXXXXXXX',
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: authCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Auth Token',
                      prefixIcon: Icon(Icons.key),
                      hintText: 'Bearer xxx...',
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () async {
                  final url = urlCtrl.text.trim();
                  final id = idCtrl.text.trim();
                  final auth = authCtrl.text.trim();

                  final prefs = await SharedPreferences.getInstance();

                  // Save server URL locally
                  await prefs.setString('server_url', url);
                  setState(() => _serverUrl = url);

                  // Save device serial locally
                  if (id.isNotEmpty) {
                    await prefs.setString('device_serial', id);
                    setState(() => _deviceSerial = id);
                  }

                  // Fetch device info now that we have config
                  if (_deviceSerial.isNotEmpty && _serverUrl.isNotEmpty) {
                    _fetchDeviceInfo();
                  }

                  // Push device config over BLE if connected
                  if (_connected) {
                    if (url.isNotEmpty)
                      await _writeChar(_svcConfig, _charServerURL, url);
                    if (id.isNotEmpty)
                      await _writeChar(_svcConfig, _charDeviceID, id);
                    if (auth.isNotEmpty)
                      await _writeChar(_svcConfig, _charAuthToken, auth);
                  }

                  if (ctx.mounted) Navigator.pop(ctx);
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                          _connected
                              ? 'Config saved to app & device.'
                              : 'Config saved.',
                        ),
                      ),
                    );
                  }
                },
                child: const Text('Save'),
              ),
            ],
          ),
    );
  }
}

/// Stateful form widget for the product bottom sheet (manages image preview state).
class _CategoryPickResult {
  final String id;
  final String path;
  final String name;
  final bool done;
  _CategoryPickResult(this.id, this.path, this.name, {this.done = false});
}

class _ProductForm extends StatefulWidget {
  final String barcode;
  final bool isEditing;
  final TextEditingController nameCtrl,
      brandCtrl,
      descCtrl,
      categoryCtrl,
      categoryIdCtrl,
      imageCtrl,
      quantityCtrl,
      weightCtrl,
      pourPriceCtrl,
      pourVolumeCtrl,
      originCtrl,
      ingredientsCtrl;
  final Future<File?> Function(ImageSource source) onPickImage;
  final Future<String?> Function(File file) onUploadImage;
  final void Function(Map<String, dynamic> data) onSave;
  final String? Function() getServerBaseUrl;

  const _ProductForm({
    required this.barcode,
    required this.isEditing,
    required this.nameCtrl,
    required this.brandCtrl,
    required this.descCtrl,
    required this.categoryCtrl,
    required this.categoryIdCtrl,
    required this.imageCtrl,
    required this.quantityCtrl,
    required this.weightCtrl,
    required this.pourPriceCtrl,
    required this.pourVolumeCtrl,
    required this.originCtrl,
    required this.ingredientsCtrl,
    required this.onPickImage,
    required this.onUploadImage,
    required this.onSave,
    required this.getServerBaseUrl,
  });

  @override
  State<_ProductForm> createState() => _ProductFormState();
}

class _ProductFormState extends State<_ProductForm> {
  File? _localImage;
  bool _uploading = false;
  List<Map<String, dynamic>> _categories = [];
  bool _categoriesLoaded = false;

  @override
  void initState() {
    super.initState();
    _loadCategories();
  }

  Future<void> _loadCategories() async {
    try {
      final baseUrl = widget.getServerBaseUrl();
      if (baseUrl == null) return;
      final resp = await http
          .get(Uri.parse('$baseUrl/api/categories'))
          .timeout(const Duration(seconds: 10));
      if (resp.statusCode == 200) {
        final list =
            (jsonDecode(resp.body) as List).cast<Map<String, dynamic>>();
        if (mounted)
          setState(() {
            _categories = list;
            _categoriesLoaded = true;
          });
      }
    } catch (e) {
      debugPrint('Failed to load categories: $e');
    }
  }

  Future<void> _showCategoryPicker() async {
    String? parentId;
    String pathSoFar = '';

    while (true) {
      final children =
          _categories.where((c) => c['parent'] == parentId).toList()..sort(
            (a, b) => (a['name'] as String).compareTo(b['name'] as String),
          );

      if (children.isEmpty) break;

      final result = await showModalBottomSheet<_CategoryPickResult>(
        context: context,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        ),
        builder: (ctx) {
          final newNameCtrl = TextEditingController();
          return StatefulBuilder(
            builder: (ctx, setSheetState) {
              return Padding(
                padding: EdgeInsets.only(
                  left: 16,
                  right: 16,
                  top: 16,
                  bottom: MediaQuery.of(ctx).viewInsets.bottom + 16,
                ),
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.of(ctx).size.height * 0.72,
                  ),
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (pathSoFar.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Text(
                              pathSoFar,
                              style: TextStyle(
                                fontSize: 12,
                                color: Colors.grey[500],
                              ),
                            ),
                          ),
                        Text(
                          parentId == null
                              ? 'Select Category'
                              : 'Select Subcategory',
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 12),
                        ...children.map(
                          (c) => ListTile(
                            dense: true,
                            title: Text(c['name'] as String),
                            trailing:
                                _categories.any((x) => x['parent'] == c['_id'])
                                    ? const Icon(Icons.chevron_right, size: 20)
                                    : null,
                            onTap:
                                () => Navigator.pop(
                                  ctx,
                                  _CategoryPickResult(
                                    c['_id'],
                                    c['path'],
                                    c['name'],
                                  ),
                                ),
                          ),
                        ),
                        const Divider(),
                        if (pathSoFar.isNotEmpty)
                          ListTile(
                            dense: true,
                            leading: const Icon(
                              Icons.check,
                              size: 20,
                              color: Colors.green,
                            ),
                            title: const Text(
                              'Use this level',
                              style: TextStyle(fontWeight: FontWeight.w500),
                            ),
                            onTap:
                                () => Navigator.pop(
                                  ctx,
                                  _CategoryPickResult(
                                    parentId!,
                                    pathSoFar,
                                    '',
                                    done: true,
                                  ),
                                ),
                          ),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: newNameCtrl,
                                decoration: const InputDecoration(
                                  hintText: 'New category name',
                                  isDense: true,
                                  border: OutlineInputBorder(),
                                  contentPadding: EdgeInsets.symmetric(
                                    horizontal: 10,
                                    vertical: 8,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            FilledButton(
                              onPressed: () async {
                                final name = newNameCtrl.text.trim();
                                if (name.isEmpty) return;
                                final baseUrl = widget.getServerBaseUrl();
                                if (baseUrl == null) return;
                                try {
                                  final resp = await http.post(
                                    Uri.parse('$baseUrl/api/category'),
                                    headers: {
                                      'Content-Type': 'application/json',
                                    },
                                    body: jsonEncode({
                                      'name': name,
                                      'parent': parentId,
                                    }),
                                  );
                                  if (resp.statusCode == 201) {
                                    final created =
                                        jsonDecode(resp.body)
                                            as Map<String, dynamic>;
                                    _categories.add(created);
                                    if (mounted) setState(() {});
                                    setSheetState(() {});
                                    newNameCtrl.clear();
                                    Navigator.pop(
                                      ctx,
                                      _CategoryPickResult(
                                        created['_id'],
                                        created['path'],
                                        created['name'],
                                      ),
                                    );
                                  }
                                } catch (_) {}
                              },
                              child: const Text('Add'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          );
        },
      );

      if (result == null) return; // dismissed
      if (result.done) {
        widget.categoryIdCtrl.text = result.id;
        widget.categoryCtrl.text = result.path;
        if (mounted) setState(() {});
        return;
      }

      // Check if selected category has children
      final hasChildren = _categories.any((c) => c['parent'] == result.id);
      if (!hasChildren) {
        widget.categoryIdCtrl.text = result.id;
        widget.categoryCtrl.text = result.path;
        if (mounted) setState(() {});
        return;
      }

      // Drill down
      parentId = result.id;
      pathSoFar = result.path;
      final currentLevel =
          _categories.firstWhere(
            (c) => c['_id'] == result.id,
            orElse: () => {},
          )['level'] ??
          1;
      if (currentLevel >= 5) {
        widget.categoryIdCtrl.text = result.id;
        widget.categoryCtrl.text = result.path;
        if (mounted) setState(() {});
        return;
      }
    }
  }

  Future<void> _handlePick(ImageSource source) async {
    final file = await widget.onPickImage(source);
    if (file == null) return;
    setState(() {
      _localImage = file;
      _uploading = true;
    });

    final url = await widget.onUploadImage(file);
    if (!mounted) return;
    setState(() => _uploading = false);

    if (url != null) {
      widget.imageCtrl.text = url;
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Image uploaded')));
      }
    } else {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Image upload failed')));
      }
    }
  }

  Widget _buildField(
    String label,
    TextEditingController ctrl, {
    int maxLines = 1,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: ctrl,
        maxLines: maxLines,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 10,
          ),
          isDense: true,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey[400],
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              widget.isEditing ? 'Edit Product' : 'Add Product',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            Text(
              'Barcode: ${widget.barcode}',
              style: TextStyle(fontSize: 13, color: Colors.grey[500]),
            ),
            const SizedBox(height: 20),

            // Image section
            Text(
              'Product Image',
              style: TextStyle(fontSize: 13, color: cs.outline),
            ),
            const SizedBox(height: 8),
            if (_localImage != null)
              Center(
                child: Stack(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: Image.file(
                        _localImage!,
                        height: 140,
                        fit: BoxFit.contain,
                      ),
                    ),
                    if (_uploading)
                      Positioned.fill(
                        child: Container(
                          decoration: BoxDecoration(
                            color: Colors.black45,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Center(
                            child: CircularProgressIndicator(
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              )
            else if (widget.imageCtrl.text.isNotEmpty)
              Center(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.network(
                    widget.imageCtrl.text,
                    height: 140,
                    fit: BoxFit.contain,
                    errorBuilder:
                        (_, __, ___) => Container(
                          height: 80,
                          width: double.infinity,
                          decoration: BoxDecoration(
                            color: cs.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Center(
                            child: Icon(Icons.broken_image, size: 32),
                          ),
                        ),
                  ),
                ),
              ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.camera_alt, size: 18),
                    label: const Text('Camera'),
                    onPressed:
                        _uploading
                            ? null
                            : () => _handlePick(ImageSource.camera),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.photo_library, size: 18),
                    label: const Text('Gallery'),
                    onPressed:
                        _uploading
                            ? null
                            : () => _handlePick(ImageSource.gallery),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            _buildField('Image URL', widget.imageCtrl),
            const SizedBox(height: 4),

            _buildField('Product Name *', widget.nameCtrl),
            _buildField('Brand', widget.brandCtrl),
            _buildField('Description', widget.descCtrl, maxLines: 2),
            // Category picker
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: GestureDetector(
                onTap: _categoriesLoaded ? _showCategoryPicker : null,
                child: InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Category',
                    border: OutlineInputBorder(),
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 10,
                    ),
                    isDense: true,
                    suffixIcon: Icon(Icons.arrow_drop_down),
                  ),
                  child: Text(
                    widget.categoryCtrl.text.isEmpty
                        ? (_categoriesLoaded ? 'Tap to select' : 'Loading...')
                        : widget.categoryCtrl.text,
                    style: TextStyle(
                      fontSize: 14,
                      color:
                          widget.categoryCtrl.text.isEmpty ? Colors.grey : null,
                    ),
                  ),
                ),
              ),
            ),
            Row(
              children: [
                Expanded(child: _buildField('Quantity', widget.quantityCtrl)),
                const SizedBox(width: 12),
                Expanded(child: _buildField('Weight', widget.weightCtrl)),
              ],
            ),
            Row(
              children: [
                Expanded(
                  child: _buildField('Price per pour', widget.pourPriceCtrl),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _buildField('Pour size (ml)', widget.pourVolumeCtrl),
                ),
              ],
            ),
            _buildField('Country of Origin', widget.originCtrl),
            _buildField('Ingredients', widget.ingredientsCtrl, maxLines: 3),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed:
                    _uploading
                        ? null
                        : () {
                          if (widget.nameCtrl.text.trim().isEmpty) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Product name is required'),
                              ),
                            );
                            return;
                          }
                          if (!widget.isEditing &&
                              widget.imageCtrl.text.trim().isEmpty) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text(
                                  'Add a product picture before saving',
                                ),
                              ),
                            );
                            return;
                          }
                          widget.onSave({
                            'name': widget.nameCtrl.text.trim(),
                            'brand': widget.brandCtrl.text.trim(),
                            'description': widget.descCtrl.text.trim(),
                            // Store the category document ID, not its display path.
                            'category':
                                widget.categoryIdCtrl.text.trim().isEmpty
                                    ? null
                                    : widget.categoryIdCtrl.text.trim(),
                            'image_url': widget.imageCtrl.text.trim(),
                            'quantity': widget.quantityCtrl.text.trim(),
                            'weight': widget.weightCtrl.text.trim(),
                            'pour_price': double.tryParse(
                              widget.pourPriceCtrl.text.trim(),
                            ),
                            'pour_volume_ml': double.tryParse(
                              widget.pourVolumeCtrl.text.trim(),
                            ),
                            'country_of_origin': widget.originCtrl.text.trim(),
                            'ingredients': widget.ingredientsCtrl.text.trim(),
                          });
                        },
                child: const Padding(
                  padding: EdgeInsets.symmetric(vertical: 14),
                  child: Text('Save Product', style: TextStyle(fontSize: 16)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Wi-Fi Settings Screen ───

class WifiSettingsScreen extends StatefulWidget {
  final bool connected;
  final String currentSSID;
  final String wifiStatus;
  final List<Map<String, dynamic>> wifiNetworks;
  final bool Function() getIsLoading;
  final Future<void> Function() onScanRequested;
  final Future<void> Function(String ssid, String password) onConnect;
  final void Function(VoidCallback listener) registerUpdateListener;
  final VoidCallback unregisterUpdateListener;

  const WifiSettingsScreen({
    super.key,
    required this.connected,
    required this.currentSSID,
    required this.wifiStatus,
    required this.wifiNetworks,
    required this.getIsLoading,
    required this.onScanRequested,
    required this.onConnect,
    required this.registerUpdateListener,
    required this.unregisterUpdateListener,
  });

  @override
  State<WifiSettingsScreen> createState() => _WifiSettingsScreenState();
}

class _WifiSettingsScreenState extends State<WifiSettingsScreen> {
  final _ssidController = TextEditingController();
  final _passwordController = TextEditingController();
  final _passFocusNode = FocusNode();
  bool _connecting = false;

  @override
  void initState() {
    super.initState();
    _ssidController.text = widget.currentSSID;
    widget.registerUpdateListener(() {
      if (mounted) {
        setState(() {});
      }
    });
  }

  @override
  void dispose() {
    widget.unregisterUpdateListener();
    _ssidController.dispose();
    _passwordController.dispose();
    _passFocusNode.dispose();
    super.dispose();
  }

  void _selectNetwork(Map<String, dynamic> net) {
    setState(() {
      _ssidController.text = net['ssid'] ?? '';
    });
    if (net['secure'] == true) {
      _passFocusNode.requestFocus();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final isLoading = widget.getIsLoading();
    final wifiNetworks = widget.wifiNetworks;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Wi-Fi Settings'),
        actions: [
          IconButton(
            tooltip: 'Scan for Wi-Fi Networks',
            onPressed:
                (!widget.connected || isLoading)
                    ? null
                    : () => widget.onScanRequested(),
            icon:
                isLoading
                    ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2.5),
                    )
                    : const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Card(
              margin: const EdgeInsets.all(16),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Icon(
                      widget.connected ? Icons.wifi : Icons.wifi_off,
                      color: widget.connected ? Colors.green : cs.error,
                      size: 28,
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Status: ${widget.wifiStatus}',
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          if (widget.currentSSID.isNotEmpty)
                            Text(
                              'Connected SSID: ${widget.currentSSID}',
                              style: theme.textTheme.bodyMedium,
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
              child: Row(
                children: [
                  Text(
                    'Nearby Wi-Fi Networks',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: cs.primary,
                    ),
                  ),
                  const Spacer(),
                  if (wifiNetworks.isNotEmpty)
                    Text(
                      '${wifiNetworks.length} found',
                      style: theme.textTheme.bodySmall,
                    ),
                ],
              ),
            ),
            Expanded(
              child:
                  wifiNetworks.isEmpty
                      ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(
                                Icons.wifi_find,
                                size: 48,
                                color: cs.outline,
                              ),
                              const SizedBox(height: 12),
                              Text(
                                isLoading
                                    ? 'Scanning for Wi-Fi networks...'
                                    : 'No networks found yet.\nTap refresh button above to scan.',
                                textAlign: TextAlign.center,
                                style: theme.textTheme.bodyMedium,
                              ),
                            ],
                          ),
                        ),
                      )
                      : ListView.separated(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 8,
                        ),
                        itemCount: wifiNetworks.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final net = wifiNetworks[index];
                          final ssid = net['ssid'] as String? ?? '';
                          final rssi = net['rssi'] as int? ?? -100;
                          final secure = net['secure'] == true;
                          final isSelected = _ssidController.text == ssid;

                          IconData wifiIcon = Icons.wifi;
                          if (rssi > -60) {
                            wifiIcon = Icons.wifi;
                          } else if (rssi > -75) {
                            wifiIcon = Icons.wifi_2_bar;
                          } else {
                            wifiIcon = Icons.wifi_1_bar;
                          }

                          return ListTile(
                            selected: isSelected,
                            selectedTileColor: cs.primaryContainer.withValues(
                              alpha: 0.3,
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                            leading: Icon(
                              secure ? Icons.lock : wifiIcon,
                              color: isSelected ? cs.primary : null,
                            ),
                            title: Text(
                              ssid,
                              style: TextStyle(
                                fontWeight:
                                    isSelected
                                        ? FontWeight.bold
                                        : FontWeight.normal,
                              ),
                            ),
                            subtitle: Text(
                              '$rssi dBm ${secure ? "• Encrypted" : "• Open"}',
                            ),
                            trailing:
                                isSelected
                                    ? Icon(
                                      Icons.check_circle,
                                      color: cs.primary,
                                    )
                                    : const Icon(Icons.chevron_right),
                            onTap: () => _selectNetwork(net),
                          );
                        },
                      ),
            ),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: theme.cardColor,
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.05),
                    blurRadius: 8,
                    offset: const Offset(0, -2),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: _ssidController,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      labelText: 'Wi-Fi Network Name (SSID)',
                      prefixIcon: const Icon(Icons.wifi),
                      suffixIcon:
                          _ssidController.text.isNotEmpty
                              ? IconButton(
                                icon: const Icon(Icons.clear),
                                onPressed:
                                    () =>
                                        setState(() => _ssidController.clear()),
                              )
                              : null,
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _passwordController,
                    focusNode: _passFocusNode,
                    onChanged: (_) => setState(() {}),
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Password',
                      prefixIcon: Icon(Icons.lock),
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed:
                          (_connecting || _ssidController.text.trim().isEmpty)
                              ? null
                              : () async {
                                setState(() => _connecting = true);
                                try {
                                  await widget.onConnect(
                                    _ssidController.text.trim(),
                                    _passwordController.text,
                                  );
                                  if (mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                        content: Text(
                                          'Wi-Fi credentials sent to scale device!',
                                        ),
                                      ),
                                    );
                                    Navigator.pop(context);
                                  }
                                } catch (e) {
                                  if (mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(content: Text('Error: $e')),
                                    );
                                  }
                                } finally {
                                  if (mounted)
                                    setState(() => _connecting = false);
                                }
                              },
                      icon:
                          _connecting
                              ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                              : const Icon(Icons.wifi_lock),
                      label: Text(
                        _connecting ? 'Connect...' : 'Connect Scale to Wi-Fi',
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
