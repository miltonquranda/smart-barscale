import 'package:flutter/material.dart';

import 'api.dart';
import 'scale_service.dart';

/// Guided capture of a bottle's physical specs using the connected scale.
///
/// This exists because the catalog backfill can only *estimate* empty-bottle
/// weight from the bottle format, and glass weight varies by well over 100g
/// between bottle shapes. On a 750ml bottle a 100g error is roughly 13% of the
/// liquid weight, and that error flows straight into pour cost — the number a
/// bar actually acts on.
///
/// The phone is already next to the scale, so measuring is a 30-second job.
/// Two captures — a full bottle, then the same bottle empty — replace the
/// estimate with a real measurement.
///
/// Full weight is captured first because that's the bottle you have in hand.
/// The empty capture can be deferred: a partial save (full weight only) is
/// still better than an estimate for a product whose empty weight is known.
class SpecCaptureSheet extends StatefulWidget {
  final String barcode;
  final String productName;
  final String baseUrl;

  /// Existing values, if the product already has some specs.
  final double? initialFullWeight;
  final double? initialEmptyWeight;
  final double? initialVolumeMl;
  final bool wasEstimated;

  const SpecCaptureSheet({
    super.key,
    required this.barcode,
    required this.productName,
    required this.baseUrl,
    this.initialFullWeight,
    this.initialEmptyWeight,
    this.initialVolumeMl,
    this.wasEstimated = false,
  });

  @override
  State<SpecCaptureSheet> createState() => _SpecCaptureSheetState();
}

class _SpecCaptureSheetState extends State<SpecCaptureSheet> {
  final _scale = ScaleService.instance;

  double? _fullWeight;
  double? _emptyWeight;
  final _volumeCtrl = TextEditingController();

  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fullWeight = widget.initialFullWeight;
    _emptyWeight = widget.initialEmptyWeight;
    if (widget.initialVolumeMl != null) {
      _volumeCtrl.text = widget.initialVolumeMl!.toStringAsFixed(0);
    }
  }

  @override
  void dispose() {
    _volumeCtrl.dispose();
    super.dispose();
  }

  double? get _volumeMl {
    final parsed = double.tryParse(_volumeCtrl.text.trim());
    return parsed != null && parsed > 0 ? parsed : null;
  }

  /// Liquid density implied by the captures. Spirits sit near 0.94 g/ml.
  double? get _density {
    final full = _fullWeight;
    final empty = _emptyWeight;
    final volume = _volumeMl;
    if (full == null || empty == null || volume == null || volume <= 0) {
      return null;
    }
    if (full <= empty) return null;
    return (full - empty) / volume;
  }

  bool get _densitySuspect {
    final d = _density;
    return d != null && (d < 0.6 || d > 1.5);
  }

  bool get _weightsInverted =>
      _fullWeight != null && _emptyWeight != null && _fullWeight! <= _emptyWeight!;

  bool get _canSave =>
      !_saving && _volumeMl != null && _fullWeight != null && !_weightsInverted;

  void _capture({required bool full}) {
    final grams = _scale.weightGrams;
    if (grams == null || grams <= 0) {
      setState(() => _error = 'No reading from the scale yet.');
      return;
    }
    setState(() {
      _error = null;
      if (full) {
        _fullWeight = grams;
      } else {
        _emptyWeight = grams;
      }
    });
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      // Uses the inventory config route rather than the product upsert: it
      // takes only spec fields, so it cannot accidentally blank a product's
      // name, category or image.
      final body = <String, dynamic>{
        'bottle_volume_ml': _volumeMl,
        'bottle_full_weight_g': _fullWeight,
        if (_emptyWeight != null) 'bottle_empty_weight_g': _emptyWeight,
        // Clear the estimate marker: these are measured now.
        'specs_estimated': false,
      };
      final resp = await SmartBarApi.put(
        widget.baseUrl,
        '/api/inventory/product/${widget.barcode}/config',
        body,
      );
      if (!mounted) return;
      if (resp.statusCode == 200) {
        Navigator.pop(context, true);
      } else {
        setState(() {
          _saving = false;
          _error = 'Save failed (${resp.statusCode}).';
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
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Measure bottle',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      Text(
                        widget.productName,
                        style: const TextStyle(
                          fontSize: 13,
                          color: Colors.black54,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context, false),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            if (widget.wasEstimated)
              Container(
                margin: const EdgeInsets.only(top: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.orange.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: const Text(
                  'This product currently uses an estimated empty weight. '
                  'Measuring it makes pour cost trustworthy.',
                  style: TextStyle(fontSize: 12),
                ),
              ),
            const SizedBox(height: 16),

            // Live reading, large enough to read at arm's length on a bar.
            _LiveWeightPanel(scale: _scale),

            const SizedBox(height: 16),
            _CaptureRow(
              step: '1',
              label: 'Full, unopened bottle',
              hint: 'Place it on the scale, wait for the reading to settle.',
              value: _fullWeight,
              onCapture: () => _capture(full: true),
              onClear: _fullWeight == null
                  ? null
                  : () => setState(() => _fullWeight = null),
            ),
            const SizedBox(height: 12),
            _CaptureRow(
              step: '2',
              label: 'Same bottle, empty',
              hint: 'Optional now — capture it when the bottle runs out.',
              value: _emptyWeight,
              onCapture: () => _capture(full: false),
              onClear: _emptyWeight == null
                  ? null
                  : () => setState(() => _emptyWeight = null),
            ),

            const SizedBox(height: 16),
            TextField(
              controller: _volumeCtrl,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                labelText: 'Bottle volume (ml)',
                helperText: 'Liquid capacity printed on the label, e.g. 750',
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),

            if (_weightsInverted)
              _Banner(
                color: Colors.red,
                text:
                    'The full bottle weighs less than the empty one. Recapture — '
                    'the two readings are probably swapped.',
              )
            else if (_density != null)
              _Banner(
                color: _densitySuspect ? Colors.orange : Colors.green,
                text: _densitySuspect
                    ? 'Implied density is ${_density!.toStringAsFixed(2)} g/ml, which is unusual. '
                          'Most spirits are around 0.94. Check the volume is in millilitres.'
                    : 'Implied density ${_density!.toStringAsFixed(2)} g/ml — that looks right for a spirit.',
              )
            else if (_fullWeight != null && _emptyWeight == null)
              const _Banner(
                color: Colors.blue,
                text:
                    'Full weight captured. Until the empty weight is measured, this '
                    'product keeps its estimated value for the empty bottle.',
              ),

            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Colors.red, fontSize: 12),
                ),
              ),

            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: _canSave ? _save : null,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(_saving ? 'Saving...' : 'Save measurements'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _LiveWeightPanel extends StatelessWidget {
  final ScaleService scale;
  const _LiveWeightPanel({required this.scale});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: scale.connected,
      builder: (context, connected, _) {
        if (!connected) {
          return Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.04),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Text(
              'Scale not connected. Connect on the Scale tab to capture weights.',
              style: TextStyle(fontSize: 13, color: Colors.black54),
            ),
          );
        }
        return ValueListenableBuilder<String>(
          valueListenable: scale.weightRaw,
          builder: (context, raw, _) {
            final grams = scale.weightGrams;
            return Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 20),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.04),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                children: [
                  const Text(
                    'LIVE SCALE',
                    style: TextStyle(
                      fontSize: 11,
                      letterSpacing: 1.2,
                      color: Colors.black54,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    grams == null ? '--' : '${grams.toStringAsFixed(1)} g',
                    style: const TextStyle(
                      fontSize: 34,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }
}

class _CaptureRow extends StatelessWidget {
  final String step;
  final String label;
  final String hint;
  final double? value;
  final VoidCallback onCapture;
  final VoidCallback? onClear;

  const _CaptureRow({
    required this.step,
    required this.label,
    required this.hint,
    required this.value,
    required this.onCapture,
    this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    final captured = value != null;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(
          color: captured
              ? Colors.green.withValues(alpha: 0.5)
              : Colors.black.withValues(alpha: 0.15),
        ),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 14,
            backgroundColor: captured ? Colors.green : Colors.black26,
            child: captured
                ? const Icon(Icons.check, size: 16, color: Colors.white)
                : Text(
                    step,
                    style: const TextStyle(
                      fontSize: 13,
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  captured ? '${value!.toStringAsFixed(1)} g' : hint,
                  style: TextStyle(
                    fontSize: 12,
                    color: captured ? Colors.green.shade800 : Colors.black54,
                  ),
                ),
              ],
            ),
          ),
          if (captured)
            IconButton(
              onPressed: onClear,
              icon: const Icon(Icons.refresh, size: 20),
              tooltip: 'Capture again',
            )
          else
            OutlinedButton(onPressed: onCapture, child: const Text('Capture')),
        ],
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  final Color color;
  final String text;
  const _Banner({required this.color, required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(text, style: TextStyle(fontSize: 12, color: color)),
    );
  }
}
