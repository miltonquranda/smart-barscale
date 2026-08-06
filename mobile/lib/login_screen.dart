import 'package:flutter/material.dart';

import 'api.dart';
import 'scale_service.dart';

/// The sign-in gate.
///
/// Nothing in the app is reachable without a session. Every scan is recorded
/// against a person, and an app that could be used signed-out would produce
/// readings attributable to nobody — which is precisely the gap the operator
/// claim exists to close. Making it the first screen means there is no path
/// that quietly bypasses it.
///
/// Sign-in always starts against the trusted bootstrap endpoint compiled into
/// the app. Endpoint configuration is deliberately not user-editable.
class LoginScreen extends StatefulWidget {
  final VoidCallback onSignedIn;

  const LoginScreen({super.key, required this.onSignedIn});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  static const _gold = Color(0xFFFFC107);
  static const _ink = Color(0xFF0D0F12);
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
    final base = ScaleService.instance.baseUrl;
    if (base == null) {
      setState(() {
        _error =
            'The app service is not configured. Install the latest app version.';
      });
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
    if (err != null) {
      setState(() {
        _busy = false;
        _error = err;
      });
      return;
    }
    _passCtrl.clear();
    widget.onSignedIn();
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Theme.of(context).brightness == Brightness.dark
                  ? _ink
                  : const Color(0xFFFFFCF4),
              Theme.of(context).brightness == Brightness.dark
                  ? const Color(0xFF171A1F)
                  : const Color(0xFFFFF8E7),
            ],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 32),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Container(
                      width: 148,
                      height: 148,
                      margin: const EdgeInsets.only(bottom: 18),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: _ink,
                        borderRadius: BorderRadius.circular(32),
                        border: Border.all(
                          color: _gold.withValues(alpha: 0.55),
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: _gold.withValues(alpha: 0.14),
                            blurRadius: 26,
                            spreadRadius: 2,
                          ),
                        ],
                      ),
                      child: Image.asset('assets/icon/app_icon.png'),
                    ),
                    Text(
                      'SmartBar',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.2,
                        color: cs.onSurface,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Inventory intelligence for every pour',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13.5,
                        height: 1.4,
                        color: _gold,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Sign in to weigh and count. Everything you scan is recorded against your name.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.4,
                        color: cs.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 28),
                    TextField(
                      controller: _emailCtrl,
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      textInputAction: TextInputAction.next,
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
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(
                          _error!,
                          style: TextStyle(color: cs.error, fontSize: 12.5),
                        ),
                      ),
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: _busy ? null : _signIn,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 13),
                        child: Text(_busy ? 'Signing in...' : 'Sign in'),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'You will connect the scale over Bluetooth after signing in.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 11.5, color: cs.outline),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
