import 'package:flutter/material.dart';

import 'api.dart';
import 'scale_service.dart';

/// Staff sign-in and session state.
///
/// The app holds two credentials with different authority. The device token,
/// derived from the scale's serial, is enough to look up products and post
/// scans — the same thing the firmware can do. Anything business-scoped
/// (counts, event logging, costs, stock levels) needs a real user, because
/// those actions are attributed to a person and expose a tenant's financial
/// data.
///
/// Signing out drops the user token but keeps the device token, so scanning
/// keeps working on a shared bar device after a manager signs out.
class AccountScreen extends StatefulWidget {
  final String? Function() getServerBaseUrl;
  final VoidCallback? onSessionChanged;

  const AccountScreen({
    super.key,
    required this.getServerBaseUrl,
    this.onSessionChanged,
  });

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    final base = widget.getServerBaseUrl();
    if (base == null) {
      setState(() => _error = 'Set the server URL on the Scale tab first.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final err = await SmartBarApi.loginUser(
      base,
      _emailCtrl.text.trim(),
      _passCtrl.text,
    );
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = err;
    });
    if (err == null) {
      _passCtrl.clear();
      widget.onSessionChanged?.call();
    }
  }

  Future<void> _signOut() async {
    await SmartBarApi.signOutUser();
    if (!mounted) return;
    setState(() {});
    widget.onSessionChanged?.call();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Account')),
      body: ValueListenableBuilder<Map<String, dynamic>?>(
        valueListenable: SmartBarApi.currentUser,
        builder: (context, user, _) {
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (user != null) ..._signedIn() else ..._signedOut(),
              const SizedBox(height: 28),
              const Divider(),
              const SizedBox(height: 12),
              _connectionCard(),
            ],
          );
        },
      ),
    );
  }

  List<Widget> _signedIn() {
    final business = SmartBarApi.businessName;
    return [
      Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(
                radius: 22,
                child: Text(
                  (SmartBarApi.userDisplayName.isNotEmpty
                          ? SmartBarApi.userDisplayName[0]
                          : '?')
                      .toUpperCase(),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      SmartBarApi.userDisplayName,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      business ?? 'No business assigned',
                      style: TextStyle(
                        fontSize: 12.5,
                        color: business == null
                            ? Colors.orange
                            : Colors.black54,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
      if (business == null)
        const Padding(
          padding: EdgeInsets.only(top: 12),
          child: Text(
            'This account is not linked to a business, so counts and inventory '
            'will not load. Ask an administrator to assign one.',
            style: TextStyle(fontSize: 12.5, color: Colors.orange),
          ),
        ),
      const SizedBox(height: 16),
      OutlinedButton.icon(
        onPressed: _signOut,
        icon: const Icon(Icons.logout, size: 18),
        label: const Text('Sign out'),
      ),
      const SizedBox(height: 8),
      const Text(
        'Signing out keeps the scale connected and scanning — it only removes '
        'access to counts, logging and costs.',
        style: TextStyle(fontSize: 12, color: Colors.black54),
      ),
    ];
  }

  List<Widget> _signedOut() {
    return [
      const Text(
        'Staff sign in',
        style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
      ),
      const SizedBox(height: 6),
      const Text(
        'Scanning works without signing in. Counts, event logging and inventory '
        'need an account, so actions can be attributed and costs stay private to '
        'your business.',
        style: TextStyle(fontSize: 12.5, color: Colors.black54, height: 1.4),
      ),
      const SizedBox(height: 16),
      TextField(
        controller: _emailCtrl,
        keyboardType: TextInputType.emailAddress,
        autocorrect: false,
        decoration: const InputDecoration(
          labelText: 'Email',
          border: OutlineInputBorder(),
          isDense: true,
        ),
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _passCtrl,
        obscureText: true,
        onSubmitted: (_) => _signIn(),
        decoration: const InputDecoration(
          labelText: 'Password',
          border: OutlineInputBorder(),
          isDense: true,
        ),
      ),
      if (_error != null)
        Padding(
          padding: const EdgeInsets.only(top: 10),
          child: Text(
            _error!,
            style: const TextStyle(color: Colors.red, fontSize: 12.5),
          ),
        ),
      const SizedBox(height: 16),
      SizedBox(
        width: double.infinity,
        child: FilledButton(
          onPressed: _busy ? null : _signIn,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(_busy ? 'Signing in...' : 'Sign in'),
          ),
        ),
      ),
    ];
  }

  Widget _connectionCard() {
    final scale = ScaleService.instance;
    return ValueListenableBuilder<bool>(
      valueListenable: scale.connected,
      builder: (context, connected, _) {
        return ValueListenableBuilder<String>(
          valueListenable: scale.serial,
          builder: (context, serial, _) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Server',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Where this app sends data. Normally read from the scale, but it '
                  'can be set here so the app works before a scale is paired.',
                  style: TextStyle(fontSize: 12, color: Colors.black54),
                ),
                const SizedBox(height: 10),
                _ServerUrlField(),
                const SizedBox(height: 24),
                const Text(
                  'Scale',
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Icon(
                      connected
                          ? Icons.bluetooth_connected
                          : Icons.bluetooth_disabled,
                      size: 18,
                      color: connected ? Colors.green : Colors.black38,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      connected
                          ? 'Connected${serial.isNotEmpty ? ' · $serial' : ''}'
                          : 'Not connected',
                      style: const TextStyle(fontSize: 13),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                const Text(
                  'Connect and configure the scale from the Scale tab.',
                  style: TextStyle(fontSize: 12, color: Colors.black54),
                ),
              ],
            );
          },
        );
      },
    );
  }
}

/// Editable server URL.
///
/// Previously the URL could only be set through the device config dialog, which
/// requires an active BLE connection — so a fresh install with no scale nearby
/// had no way to reach the API at all, and every tab reported "no server URL
/// configured" with no way to fix it.
class _ServerUrlField extends StatefulWidget {
  @override
  State<_ServerUrlField> createState() => _ServerUrlFieldState();
}

class _ServerUrlFieldState extends State<_ServerUrlField> {
  late final TextEditingController _ctrl;
  bool _dirty = false;
  String? _saved;

  @override
  void initState() {
    super.initState();
    _ctrl = TextEditingController(text: ScaleService.instance.serverUrl.value);
    ScaleService.instance.serverUrl.addListener(_onExternalChange);
  }

  /// Keep in step when the scale reports its own configured URL over BLE,
  /// unless the field is mid-edit.
  void _onExternalChange() {
    if (!mounted || _dirty) return;
    final value = ScaleService.instance.serverUrl.value;
    if (value != _ctrl.text) setState(() => _ctrl.text = value);
  }

  @override
  void dispose() {
    ScaleService.instance.serverUrl.removeListener(_onExternalChange);
    _ctrl.dispose();
    super.dispose();
  }

  void _save() {
    final value = _ctrl.text.trim();
    ScaleService.instance.setServerUrl(value, persist: true);
    setState(() {
      _dirty = false;
      _saved = value.isEmpty ? 'Cleared.' : 'Saved.';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: _ctrl,
          keyboardType: TextInputType.url,
          autocorrect: false,
          onChanged: (_) => setState(() {
            _dirty = true;
            _saved = null;
          }),
          decoration: const InputDecoration(
            labelText: 'Server URL',
            hintText: 'https://smartbarscale.com',
            border: OutlineInputBorder(),
            isDense: true,
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            FilledButton.tonal(
              onPressed: _dirty ? _save : null,
              child: const Text('Save'),
            ),
            const SizedBox(width: 12),
            if (_saved != null)
              Text(
                _saved!,
                style: const TextStyle(fontSize: 12, color: Colors.green),
              ),
          ],
        ),
      ],
    );
  }
}
