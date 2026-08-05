import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';

import 'api.dart';
import 'scale_service.dart';
import 'spec_capture.dart';

/// One counted bottle, held locally until the count is submitted.
class CountEntry {
  final String barcode;
  final String name;
  final String brand;
  final double openWeightG;
  int sealedCount;
  final bool needsSpecs;

  CountEntry({
    required this.barcode,
    required this.name,
    required this.brand,
    required this.openWeightG,
    required this.sealedCount,
    required this.needsSpecs,
  });
}

/// Count mode: walk the bar, scan a bottle, let the scale weigh it, enter how
/// many sealed bottles are behind it, move on.
///
/// The whole count is held in memory and submitted as a single opening count at
/// the end. That is deliberate — a count is a statement about one moment in
/// time, and dribbling readings in one at a time as you walk would spread that
/// moment across an hour and make the deltas between them look like
/// consumption.
///
/// Products missing weight specs can still be counted (the sealed count is
/// meaningful on its own), but they're flagged, and the operator can measure
/// them without leaving the flow.
class CountScreen extends StatefulWidget {
  final String? Function() getServerBaseUrl;
  const CountScreen({super.key, required this.getServerBaseUrl});

  @override
  State<CountScreen> createState() => _CountScreenState();
}

class _CountScreenState extends State<CountScreen> {
  final _scale = ScaleService.instance;
  final List<CountEntry> _entries = [];

  StreamSubscription<String>? _barcodeSub;
  bool _counting = false;
  bool _submitting = false;
  String? _message;

  /// Barcode awaiting a sealed-count entry.
  String? _pendingBarcode;

  @override
  void initState() {
    super.initState();
    _barcodeSub = _scale.barcodeStream.stream.listen(_onBarcode);
  }

  @override
  void dispose() {
    _barcodeSub?.cancel();
    super.dispose();
  }

  Future<void> _onBarcode(String barcode) async {
    if (!_counting || !mounted) return;
    if (_pendingBarcode == barcode) return; // already being handled

    final weight = _scale.weightGrams;
    if (weight == null) {
      setState(() => _message = 'Scanned $barcode but the scale had no reading.');
      return;
    }

    _pendingBarcode = barcode;
    final base = widget.getServerBaseUrl();
    if (base == null) {
      setState(() => _message = 'Set the server URL on the Account tab to connect.');
      _pendingBarcode = null;
      return;
    }

    Map<String, dynamic>? product;
    try {
      final resp = await SmartBarApi.get(base, '/api/product/$barcode');
      if (resp.statusCode == 200) {
        product = jsonDecode(resp.body) as Map<String, dynamic>;
      }
    } catch (_) {
      // Fall through — handled as an unknown product below.
    }
    if (!mounted) return;

    if (product == null) {
      setState(() {
        _message = 'Barcode $barcode is not in the catalog. Add it from the Scale tab first.';
      });
      _pendingBarcode = null;
      return;
    }

    final needsSpecs = !(_num(product['bottle_full_weight_g']) > 0
        && _num(product['bottle_empty_weight_g']) > 0
        && _num(product['bottle_volume_ml']) > 0);

    final existingIndex = _entries.indexWhere((e) => e.barcode == barcode);
    final sealed = await _askSealedCount(
      name: product['name']?.toString() ?? barcode,
      initial: existingIndex >= 0 ? _entries[existingIndex].sealedCount : 0,
    );
    _pendingBarcode = null;
    if (sealed == null || !mounted) return;

    final entry = CountEntry(
      barcode: barcode,
      name: product['name']?.toString() ?? barcode,
      brand: product['brand']?.toString() ?? '',
      openWeightG: weight,
      sealedCount: sealed,
      needsSpecs: needsSpecs,
    );

    setState(() {
      if (existingIndex >= 0) {
        // Rescanning a bottle replaces the earlier reading rather than adding a
        // duplicate — a recount is a correction, not another bottle.
        _entries[existingIndex] = entry;
        _message = 'Updated ${entry.name}.';
      } else {
        _entries.add(entry);
        _message = null;
      }
    });
  }

  double _num(dynamic v) => double.tryParse('${v ?? 0}') ?? 0;

  Future<int?> _askSealedCount({
    required String name,
    required int initial,
  }) async {
    final ctrl = TextEditingController(text: initial.toString());
    return showDialog<int>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: Text(name, style: const TextStyle(fontSize: 16)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Open bottle weighed at ${_scale.weightGrams?.toStringAsFixed(1) ?? '--'} g.',
              style: const TextStyle(fontSize: 13, color: Colors.black54),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: ctrl,
              autofocus: true,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Unopened bottles behind the bar',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, null),
            child: const Text('Skip'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(ctx, int.tryParse(ctrl.text.trim()) ?? 0),
            child: const Text('Add to count'),
          ),
        ],
      ),
    );
  }

  Future<void> _measureSpecs(CountEntry entry) async {
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
        barcode: entry.barcode,
        productName: entry.name,
        baseUrl: base,
      ),
    );
    if (saved == true && mounted) {
      setState(() => _message = 'Specs saved for ${entry.name}.');
    }
  }

  Future<void> _submit() async {
    final base = widget.getServerBaseUrl();
    if (base == null) return;
    setState(() {
      _submitting = true;
      _message = null;
    });
    try {
      final resp = await SmartBarApi.post(
        base,
        '/api/inventory/opening-count',
        {
          'notes': 'Counted on mobile',
          'items': _entries
              .map((e) => {
                    'barcode': e.barcode,
                    'sealed_count': e.sealedCount,
                    'open_weight_g': e.openWeightG,
                  })
              .toList(),
        },
        timeout: const Duration(seconds: 45),
      );
      if (!mounted) return;
      final body = jsonDecode(resp.body) as Map<String, dynamic>;
      if (resp.statusCode == 201 || resp.statusCode == 200) {
        final recorded = body['recorded'] ?? 0;
        final failed = body['failed'] ?? 0;
        setState(() {
          _entries.clear();
          _counting = false;
          _submitting = false;
          _message = 'Count submitted: $recorded recorded'
              '${failed > 0 ? ', $failed skipped (missing specs)' : ''}.';
        });
      } else if (resp.statusCode == 401 || resp.statusCode == 403) {
        setState(() {
          _submitting = false;
          _message = 'Sign in as staff to submit a count.';
        });
      } else {
        setState(() {
          _submitting = false;
          _message = body['error']?.toString() ?? 'Submit failed.';
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _message = 'Could not reach the server.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final needingSpecs = _entries.where((e) => e.needsSpecs).length;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Count'),
        actions: [
          if (_entries.isNotEmpty)
            TextButton(
              onPressed: _submitting
                  ? null
                  : () async {
                      final ok = await showDialog<bool>(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: const Text('Discard this count?'),
                          content: Text(
                            '${_entries.length} bottle(s) have been counted but not '
                            'submitted. They will be lost.',
                          ),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(ctx, false),
                              child: const Text('Keep counting'),
                            ),
                            FilledButton(
                              onPressed: () => Navigator.pop(ctx, true),
                              child: const Text('Discard'),
                            ),
                          ],
                        ),
                      );
                      if (ok == true && mounted) {
                        setState(() {
                          _entries.clear();
                          _counting = false;
                          _message = null;
                        });
                      }
                    },
              child: const Text('Discard'),
            ),
        ],
      ),
      body: Column(
        children: [
          _CountHeader(
            scale: _scale,
            counting: _counting,
            count: _entries.length,
            onToggle: () => setState(() {
              _counting = !_counting;
              _message = _counting
                  ? 'Scan a bottle to add it to the count.'
                  : 'Counting paused.';
            }),
          ),
          if (_message != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              color: Colors.blue.withValues(alpha: 0.06),
              child: Text(
                _message!,
                style: const TextStyle(fontSize: 12.5),
              ),
            ),
          if (needingSpecs > 0)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              color: Colors.orange.withValues(alpha: 0.10),
              child: Text(
                '$needingSpecs counted bottle(s) have no measured weights. Their sealed '
                'count will record, but the open bottle cannot be valued until specs are set.',
                style: const TextStyle(fontSize: 12.5, color: Colors.orange),
              ),
            ),
          Expanded(
            child: _entries.isEmpty
                ? const _EmptyCount()
                : ListView.separated(
                    itemCount: _entries.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, i) {
                      final e = _entries[_entries.length - 1 - i];
                      return ListTile(
                        title: Text(e.name),
                        subtitle: Text(
                          '${e.openWeightG.toStringAsFixed(0)} g open · '
                          '${e.sealedCount} sealed'
                          '${e.brand.isNotEmpty ? ' · ${e.brand}' : ''}',
                          style: const TextStyle(fontSize: 12),
                        ),
                        trailing: e.needsSpecs
                            ? TextButton(
                                onPressed: () => _measureSpecs(e),
                                child: const Text('Measure'),
                              )
                            : const Icon(
                                Icons.check_circle,
                                color: Colors.green,
                                size: 20,
                              ),
                      );
                    },
                  ),
          ),
          if (_entries.isNotEmpty)
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _submitting ? null : _submit,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: Text(
                        _submitting
                            ? 'Submitting...'
                            : 'Submit count (${_entries.length})',
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _CountHeader extends StatelessWidget {
  final ScaleService scale;
  final bool counting;
  final int count;
  final VoidCallback onToggle;

  const _CountHeader({
    required this.scale,
    required this.counting,
    required this.count,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: scale.connected,
      builder: (context, connected, _) {
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          color: Colors.black.withValues(alpha: 0.03),
          child: Column(
            children: [
              if (!connected)
                const Text(
                  'Scale not connected. Connect on the Scale tab to count.',
                  style: TextStyle(fontSize: 13, color: Colors.black54),
                )
              else
                ValueListenableBuilder<String>(
                  valueListenable: scale.weightRaw,
                  builder: (context, _, _) {
                    final g = scale.weightGrams;
                    return Column(
                      children: [
                        Text(
                          g == null ? '--' : '${g.toStringAsFixed(1)} g',
                          style: const TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          counting
                              ? 'Scan a bottle to record it'
                              : 'Counting paused',
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.black54,
                          ),
                        ),
                      ],
                    );
                  },
                ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  FilledButton.tonal(
                    onPressed: connected ? onToggle : null,
                    child: Text(counting ? 'Pause counting' : 'Start counting'),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    '$count counted',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}

class _EmptyCount extends StatelessWidget {
  const _EmptyCount();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.inventory_2_outlined, size: 48, color: Colors.black26),
          SizedBox(height: 12),
          Text(
            'Nothing counted yet',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
          SizedBox(height: 8),
          Text(
            'Start counting, then put each open bottle on the scale and scan it. '
            'Enter how many unopened bottles are behind it and move to the next.\n\n'
            'The whole count is submitted at once, so it captures a single moment '
            'rather than spreading across the time it takes you to walk the bar.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: Colors.black54, height: 1.5),
          ),
        ],
      ),
    );
  }
}
