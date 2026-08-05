import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import 'api.dart';
import 'scale_service.dart';
import 'spec_capture.dart';

/// At-a-glance stock position, with the two edits a manager most often wants to
/// make on the floor: pour price and par level.
///
/// Sorted so what needs attention floats to the top — below par first, then
/// products with no measured specs. A flat alphabetical list would bury both.
class InventoryScreen extends StatefulWidget {
  final String? Function() getServerBaseUrl;
  const InventoryScreen({super.key, required this.getServerBaseUrl});

  @override
  State<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends State<InventoryScreen> {
  List<Map<String, dynamic>> _items = [];
  Map<String, dynamic> _counts = {};
  bool _loading = true;
  bool _needsSignIn = false;
  String? _error;
  String _filter = 'all';
  final _searchCtrl = TextEditingController();
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    // Tabs are built at launch, before the scale screen has finished restoring
    // the saved server URL, so a one-shot read here would always miss it.
    // Reload whenever the URL arrives or changes.
    ScaleService.instance.serverUrl.addListener(_onServerUrlChanged);
    _load();
  }

  void _onServerUrlChanged() {
    if (mounted) _load();
  }

  @override
  void dispose() {
    ScaleService.instance.serverUrl.removeListener(_onServerUrlChanged);
    _debounce?.cancel();
    _searchCtrl.dispose();
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
      final search = _searchCtrl.text.trim();
      final query = [
        if (search.isNotEmpty) 'search=${Uri.encodeQueryComponent(search)}',
        if (_filter != 'all') 'only=$_filter',
      ].join('&');
      final data = await SmartBarApi.getJson(
        base,
        '/api/inventory/summary${query.isEmpty ? '' : '?$query'}',
        timeout: const Duration(seconds: 25),
      );
      if (!mounted) return;
      final map = data as Map<String, dynamic>;
      setState(() {
        _items = (map['items'] as List).cast<Map<String, dynamic>>();
        _counts = (map['counts'] as Map).cast<String, dynamic>();
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
        _error = 'Could not load inventory.';
      });
    }
  }

  void _onSearchChanged(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _load);
  }

  Future<void> _editPricing(Map<String, dynamic> item) async {
    final base = widget.getServerBaseUrl();
    if (base == null) return;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _PricingSheet(baseUrl: base, item: item),
    );
    if (saved == true) _load();
  }

  Future<void> _measure(Map<String, dynamic> item) async {
    final base = widget.getServerBaseUrl();
    if (base == null) return;
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => SpecCaptureSheet(
        barcode: item['barcode'].toString(),
        productName: item['name']?.toString() ?? '',
        baseUrl: base,
        initialVolumeMl: _toDouble(item['bottle_volume_ml']),
        wasEstimated: item['specs_estimated'] == true,
      ),
    );
    if (saved == true) _load();
  }

  static double? _toDouble(dynamic v) =>
      v == null ? null : double.tryParse(v.toString());

  @override
  Widget build(BuildContext context) {
    if (_needsSignIn) {
      return Scaffold(
        appBar: AppBar(title: const Text('Inventory')),
        body: const _SignInRequired(),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Inventory'),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _searchCtrl,
              onChanged: _onSearchChanged,
              decoration: const InputDecoration(
                hintText: 'Search products',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                _FilterChip(
                  label: 'All',
                  selected: _filter == 'all',
                  onTap: () => setState(() {
                    _filter = 'all';
                    _load();
                  }),
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'Below par (${_counts['below_par'] ?? 0})',
                  selected: _filter == 'low_stock',
                  onTap: () => setState(() {
                    _filter = 'low_stock';
                    _load();
                  }),
                ),
                const SizedBox(width: 8),
                _FilterChip(
                  label: 'Needs measuring (${_counts['needs_specs'] ?? 0})',
                  selected: _filter == 'missing_specs',
                  onTap: () => setState(() {
                    _filter = 'missing_specs';
                    _load();
                  }),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.red),
                      ),
                    ),
                  )
                : _items.isEmpty
                ? const _EmptyInventory()
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView.separated(
                      itemCount: _items.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, i) => _row(_items[i]),
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _row(Map<String, dynamic> item) {
    final belowPar = item['below_par'] == true;
    final needsSpecs = item['needs_specs'] == true;
    final estimated = item['specs_estimated'] == true;
    final pourCost = _toDouble(item['pour_cost_pct']);
    final bottles = _toDouble(item['on_hand_bottles']);

    return ListTile(
      title: Text(
        item['name']?.toString() ?? '',
        style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w500),
      ),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              [
                bottles == null
                    ? '${item['on_hand_ml'] ?? 0} ml'
                    : '${bottles.toStringAsFixed(1)} bottles',
                if (item['on_hand_value'] != null)
                  '\$${_toDouble(item['on_hand_value'])!.toStringAsFixed(2)}',
                if (pourCost != null) '${pourCost.toStringAsFixed(1)}% pour cost',
              ].join(' · '),
              style: const TextStyle(fontSize: 12),
            ),
            if (belowPar || needsSpecs || estimated)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Wrap(
                  spacing: 6,
                  children: [
                    if (belowPar)
                      _Tag(
                        text: 'below par (${item['par_level']})',
                        color: Colors.red,
                      ),
                    if (needsSpecs)
                      const _Tag(text: 'no specs', color: Colors.orange),
                    if (estimated && !needsSpecs)
                      const _Tag(
                        text: 'estimated weight',
                        color: Colors.orange,
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
      trailing: PopupMenuButton<String>(
        onSelected: (v) {
          if (v == 'price') _editPricing(item);
          if (v == 'measure') _measure(item);
        },
        itemBuilder: (_) => [
          const PopupMenuItem(
            value: 'price',
            child: Text('Pour price & par'),
          ),
          const PopupMenuItem(
            value: 'measure',
            child: Text('Measure bottle'),
          ),
        ],
      ),
    );
  }
}

class _PricingSheet extends StatefulWidget {
  final String baseUrl;
  final Map<String, dynamic> item;
  const _PricingSheet({required this.baseUrl, required this.item});

  @override
  State<_PricingSheet> createState() => _PricingSheetState();
}

class _PricingSheetState extends State<_PricingSheet> {
  late final TextEditingController _priceCtrl;
  late final TextEditingController _sizeCtrl;
  late final TextEditingController _parCtrl;
  late final TextEditingController _costCtrl;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    String s(dynamic v) => v == null ? '' : v.toString();
    _priceCtrl = TextEditingController(text: s(widget.item['pour_price']));
    _sizeCtrl = TextEditingController(text: s(widget.item['pour_volume_ml']));
    _parCtrl = TextEditingController(text: s(widget.item['par_level']));
    _costCtrl = TextEditingController(text: s(widget.item['cost_per_bottle']));
  }

  @override
  void dispose() {
    _priceCtrl.dispose();
    _sizeCtrl.dispose();
    _parCtrl.dispose();
    _costCtrl.dispose();
    super.dispose();
  }

  double? _val(TextEditingController c) {
    final t = c.text.trim();
    return t.isEmpty ? null : double.tryParse(t);
  }

  /// Live pour cost from the values being typed, so the manager sees the
  /// consequence of a price before saving it.
  double? get _previewPourCost {
    final cost = _val(_costCtrl);
    final volume = double.tryParse(
      widget.item['bottle_volume_ml']?.toString() ?? '',
    );
    final price = _val(_priceCtrl);
    final size = _val(_sizeCtrl);
    if (cost == null || volume == null || price == null || size == null) {
      return null;
    }
    if (volume <= 0 || price <= 0 || size <= 0) return null;
    return ((cost / volume) * size / price) * 100;
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final resp = await SmartBarApi.put(
        widget.baseUrl,
        '/api/inventory/product/${widget.item['barcode']}/config',
        {
          'pour_price': _val(_priceCtrl),
          'pour_volume_ml': _val(_sizeCtrl),
          'par_level': _val(_parCtrl),
          'cost_per_bottle': _val(_costCtrl),
        },
      );
      if (!mounted) return;
      if (resp.statusCode == 200) {
        Navigator.pop(context, true);
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
    final preview = _previewPourCost;
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
                Expanded(
                  child: Text(
                    widget.item['name']?.toString() ?? 'Product',
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context, false),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _priceCtrl,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      labelText: 'Pour price',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _sizeCtrl,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      labelText: 'Pour size (ml)',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _costCtrl,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      labelText: 'Cost per bottle',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                    controller: _parCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Par level',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
              ],
            ),
            if (preview != null)
              Container(
                margin: const EdgeInsets.only(top: 14),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: (preview > 25 ? Colors.red : Colors.green).withValues(
                    alpha: 0.10,
                  ),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  'Pour cost at these values: ${preview.toStringAsFixed(1)}%'
                  '${preview > 25 ? ' — above the usual 18–22% target' : ''}',
                  style: TextStyle(
                    fontSize: 12.5,
                    color: preview > 25 ? Colors.red : Colors.green.shade800,
                  ),
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
                  child: Text(_saving ? 'Saving...' : 'Save'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ChoiceChip(
      label: Text(label, style: const TextStyle(fontSize: 12.5)),
      selected: selected,
      onSelected: (_) => onTap(),
    );
  }
}

class _Tag extends StatelessWidget {
  final String text;
  final Color color;
  const _Tag({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(text, style: TextStyle(fontSize: 10.5, color: color)),
    );
  }
}

class _EmptyInventory extends StatelessWidget {
  const _EmptyInventory();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.liquor_outlined, size: 48, color: Colors.black26),
          SizedBox(height: 12),
          Text(
            'No stock recorded',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          SizedBox(height: 8),
          Text(
            'Run a count from the Count tab to establish where your stock stands. '
            'Everything here builds from that baseline.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: Colors.black54, height: 1.5),
          ),
        ],
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
            'Stock levels and costs are business data, so they need a real account '
            'rather than the shared device credential. Sign in from the Settings tab.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: Colors.black54, height: 1.5),
          ),
        ],
      ),
    );
  }
}
