import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import 'api.dart';
import 'scale_service.dart';

/// Log breakage, spoilage, comps and deliveries from behind the bar.
///
/// These events are the difference between "we're short 3 bottles" and "we
/// broke two and comped one". Without them, every loss looks identical to
/// theft, and the variance figures on the dashboard are unusable as a
/// management tool.
///
/// The whole point is that it happens *at the moment*, so this is built for
/// speed: pick a type, pick a product (scan it if it's in your hand), quantity,
/// done. Anything that slows this down means it doesn't get logged at all.
class EventsScreen extends StatefulWidget {
  final String? Function() getServerBaseUrl;
  const EventsScreen({super.key, required this.getServerBaseUrl});

  @override
  State<EventsScreen> createState() => _EventsScreenState();
}

class _EventsScreenState extends State<EventsScreen> {
  List<Map<String, dynamic>> _recent = [];
  bool _loading = true;
  bool _needsSignIn = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // See InventoryScreen: the server URL is restored asynchronously after the
    // tabs are built, so react to it rather than reading it once.
    ScaleService.instance.serverUrl.addListener(_onServerUrlChanged);
    _load();
  }

  void _onServerUrlChanged() {
    if (mounted) _load();
  }

  @override
  void dispose() {
    ScaleService.instance.serverUrl.removeListener(_onServerUrlChanged);
    super.dispose();
  }

  Future<void> _load() async {
    final base = widget.getServerBaseUrl();
    if (base == null) {
      setState(() {
        _loading = false;
        _error = 'Set the server URL on the Account tab to connect.';
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _needsSignIn = false;
    });
    try {
      final data = await SmartBarApi.getJson(
        base,
        '/api/inventory/events?limit=25',
      );
      if (!mounted) return;
      setState(() {
        _recent = (data as List).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } on NeedsSignIn {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _needsSignIn = true;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load recent events.';
      });
    }
  }

  Future<void> _openLogSheet(String eventType) async {
    final base = widget.getServerBaseUrl();
    if (base == null) return;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _LogEventSheet(baseUrl: base, initialType: eventType),
    );
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Log'),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: _needsSignIn
          ? const _SignInRequired()
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const Text(
                    'What happened?',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Logging these as they happen is what separates a real loss from '
                    'an unexplained one.',
                    style: TextStyle(fontSize: 12.5, color: Colors.black54),
                  ),
                  const SizedBox(height: 14),
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 10,
                    childAspectRatio: 2.1,
                    children: [
                      _EventButton(
                        icon: Icons.broken_image_outlined,
                        label: 'Breakage',
                        color: Colors.red,
                        onTap: () => _openLogSheet('breakage'),
                      ),
                      _EventButton(
                        icon: Icons.card_giftcard,
                        label: 'Comp',
                        color: Colors.orange,
                        onTap: () => _openLogSheet('comp'),
                      ),
                      _EventButton(
                        icon: Icons.local_shipping_outlined,
                        label: 'Delivery',
                        color: Colors.green,
                        onTap: () => _openLogSheet('delivery'),
                      ),
                      _EventButton(
                        icon: Icons.delete_outline,
                        label: 'Spoilage',
                        color: Colors.brown,
                        onTap: () => _openLogSheet('spoilage'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Recent',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  if (_loading)
                    const Padding(
                      padding: EdgeInsets.all(24),
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (_error != null)
                    Text(
                      _error!,
                      style: const TextStyle(color: Colors.red, fontSize: 13),
                    )
                  else if (_recent.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: Text(
                        'Nothing logged yet.',
                        style: TextStyle(color: Colors.black54, fontSize: 13),
                      ),
                    )
                  else
                    ..._recent.map(_eventTile),
                ],
              ),
            ),
    );
  }

  Widget _eventTile(Map<String, dynamic> e) {
    final type = (e['event_type'] ?? '').toString();
    final colors = {
      'breakage': Colors.red,
      'spoilage': Colors.brown,
      'comp': Colors.orange,
      'delivery': Colors.green,
      'transfer_in': Colors.green,
      'transfer_out': Colors.purple,
    };
    final color = colors[type] ?? Colors.blueGrey;
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        radius: 16,
        backgroundColor: color.withValues(alpha: 0.15),
        child: Icon(Icons.circle, size: 10, color: color),
      ),
      title: Text(
        '${type[0].toUpperCase()}${type.substring(1)} · ${e['quantity'] ?? 0}',
        style: const TextStyle(fontSize: 14),
      ),
      subtitle: Text(
        [
          e['barcode']?.toString() ?? '',
          e['date']?.toString() ?? '',
          if ((e['notes']?.toString() ?? '').isNotEmpty) e['notes'].toString(),
        ].where((s) => s.isNotEmpty).join(' · '),
        style: const TextStyle(fontSize: 11.5),
      ),
    );
  }
}

class _LogEventSheet extends StatefulWidget {
  final String baseUrl;
  final String initialType;
  const _LogEventSheet({required this.baseUrl, required this.initialType});

  @override
  State<_LogEventSheet> createState() => _LogEventSheetState();
}

class _LogEventSheetState extends State<_LogEventSheet> {
  final _scale = ScaleService.instance;
  final _qtyCtrl = TextEditingController(text: '1');
  final _notesCtrl = TextEditingController();
  final _searchCtrl = TextEditingController();

  late String _type;
  Map<String, dynamic>? _product;
  List<Map<String, dynamic>> _results = [];
  bool _searching = false;
  bool _saving = false;
  String? _error;
  StreamSubscription<String>? _barcodeSub;
  Timer? _debounce;

  static const _types = {
    'breakage': 'Breakage',
    'spoilage': 'Spoilage',
    'comp': 'Comp / giveaway',
    'delivery': 'Delivery',
    'transfer_in': 'Transfer in',
    'transfer_out': 'Transfer out',
  };

  @override
  void initState() {
    super.initState();
    _type = widget.initialType;
    // If the bottle is in your hand, scanning it is faster than searching.
    _barcodeSub = _scale.barcodeStream.stream.listen((code) {
      if (mounted) _lookupBarcode(code);
    });
  }

  @override
  void dispose() {
    _barcodeSub?.cancel();
    _debounce?.cancel();
    _qtyCtrl.dispose();
    _notesCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _lookupBarcode(String barcode) async {
    try {
      final resp = await SmartBarApi.get(
        widget.baseUrl,
        '/api/product/$barcode',
      );
      if (!mounted) return;
      if (resp.statusCode == 200) {
        setState(() {
          _product = jsonDecode(resp.body) as Map<String, dynamic>;
          _results = [];
          _searchCtrl.clear();
        });
      }
    } catch (_) {
      // Silent: scanning is a convenience here, search is the fallback.
    }
  }

  void _onSearchChanged(String term) {
    _debounce?.cancel();
    if (term.trim().length < 2) {
      setState(() => _results = []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () => _search(term));
  }

  Future<void> _search(String term) async {
    setState(() => _searching = true);
    try {
      final data = await SmartBarApi.getJson(
        widget.baseUrl,
        '/api/bottles/search?q=${Uri.encodeQueryComponent(term.trim())}&limit=20',
      );
      if (!mounted) return;
      setState(() {
        _results = ((data as Map)['results'] as List).cast<Map<String, dynamic>>();
        _searching = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _searching = false);
    }
  }

  Future<void> _save() async {
    if (_product == null) {
      setState(() => _error = 'Pick a product first.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final resp = await SmartBarApi.post(
        widget.baseUrl,
        '/api/inventory/event',
        {
          'barcode': _product!['barcode'],
          'product_id': _product!['_id'],
          'event_type': _type,
          'quantity': int.tryParse(_qtyCtrl.text.trim()) ?? 1,
          'notes': _notesCtrl.text.trim(),
        },
      );
      if (!mounted) return;
      if (resp.statusCode == 201) {
        Navigator.pop(context, true);
      } else if (resp.statusCode == 401 || resp.statusCode == 403) {
        setState(() {
          _saving = false;
          _error = 'Sign in as staff to log events.';
        });
      } else {
        final body = jsonDecode(resp.body) as Map<String, dynamic>;
        setState(() {
          _saving = false;
          _error = body['error']?.toString() ?? 'Save failed.';
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'Could not reach the server.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Log event',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context, false),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              // `value:`, not `initialValue:` — the latter only exists on
              // Flutter 3.35+, and this project's floor is 3.29. The existing
              // business picker in main.dart uses the same form.
              value: _type,
              decoration: const InputDecoration(
                labelText: 'Type',
                border: OutlineInputBorder(),
                isDense: true,
              ),
              items: _types.entries
                  .map(
                    (e) => DropdownMenuItem(value: e.key, child: Text(e.value)),
                  )
                  .toList(),
              onChanged: (v) => setState(() => _type = v ?? _type),
            ),
            const SizedBox(height: 12),

            if (_product != null)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(_product!['name']?.toString() ?? 'Product'),
                subtitle: Text(
                  _product!['barcode']?.toString() ?? '',
                  style: const TextStyle(fontSize: 12),
                ),
                trailing: TextButton(
                  onPressed: () => setState(() => _product = null),
                  child: const Text('Change'),
                ),
              )
            else ...[
              TextField(
                controller: _searchCtrl,
                onChanged: _onSearchChanged,
                decoration: InputDecoration(
                  labelText: 'Find product',
                  helperText: 'Or scan the bottle on the scale',
                  border: const OutlineInputBorder(),
                  isDense: true,
                  suffixIcon: _searching
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : const Icon(Icons.search),
                ),
              ),
              if (_results.isNotEmpty)
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 220),
                  child: ListView.builder(
                    shrinkWrap: true,
                    itemCount: _results.length,
                    itemBuilder: (context, i) {
                      final r = _results[i];
                      return ListTile(
                        dense: true,
                        title: Text(r['name']?.toString() ?? ''),
                        subtitle: Text(
                          r['brand']?.toString() ?? '',
                          style: const TextStyle(fontSize: 11.5),
                        ),
                        onTap: () => setState(() {
                          _product = r;
                          _results = [];
                          _searchCtrl.clear();
                        }),
                      );
                    },
                  ),
                ),
            ],

            const SizedBox(height: 12),
            TextField(
              controller: _qtyCtrl,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: 'Bottles',
                helperText: _type == 'delivery' || _type == 'transfer_in'
                    ? 'How many arrived'
                    : 'How many were lost',
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _notesCtrl,
              decoration: const InputDecoration(
                labelText: 'Notes (optional)',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),

            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Colors.red, fontSize: 12),
                ),
              ),

            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _saving ? null : _save,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(_saving ? 'Saving...' : 'Log it'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EventButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _EventButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Icon(icon, color: color, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: color,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SignInRequired extends StatelessWidget {
  const _SignInRequired();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.lock_outline, size: 44, color: Colors.black26),
          SizedBox(height: 12),
          Text(
            'Staff sign in required',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          SizedBox(height: 8),
          Text(
            'Events are attributed to whoever logged them, so this needs a real '
            'account rather than the shared device credential. Sign in from the '
            'Settings tab.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: Colors.black54, height: 1.5),
          ),
        ],
      ),
    );
  }
}
