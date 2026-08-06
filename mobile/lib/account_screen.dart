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
      setState(() => _error = 'The app service is temporarily unavailable.');
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
    // Order matters. Release the claim while the session is still valid —
    // afterwards the request would be unauthenticated and the scale would stay
    // claimed by someone who has gone home.
    final base = widget.getServerBaseUrl();
    if (base != null) await SmartBarApi.releaseScale(base);

    // Then drop the Bluetooth link. The app is unusable signed out, and
    // leaving a live connection to a scale nobody is signed in to would mean
    // readings arriving with no one to attribute them to.
    ScaleService.instance.requestDisconnect();

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
              // The app gates on sign-in at launch, so this screen only ever
              // renders signed in. The fallback stays for the moment between
              // signing out and the gate rebuilding.
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
                        color:
                            business == null ? Colors.orange : Colors.black54,
                      ),
                    ),
                    if (SmartBarApi.role != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          SmartBarApi.canSeeFinancials
                              ? '${SmartBarApi.role} · full access'
                              : '${SmartBarApi.role} · scanning and counts, '
                                  'costs and pricing hidden',
                          style: const TextStyle(
                            fontSize: 11.5,
                            color: Colors.black45,
                          ),
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
        'Signing out releases the scale and disconnects it. You will need to '
        'reconnect after signing back in.\n\n'
        'To hand the scale to someone else, you can just disconnect Bluetooth '
        '— there is no need to sign out.',
        style: TextStyle(fontSize: 12, color: Colors.black54, height: 1.4),
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
        'Anyone at the bar can sign in with their own account — owner, manager '
        'or staff. Scans made while you are signed in are recorded against you, '
        'so a shortfall can be traced to a shift rather than a serial number.',
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
