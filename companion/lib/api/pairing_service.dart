import 'device_pairing.dart';

/// Pairing as the tray menu sees it ("Appairer" / "Délier").
abstract interface class PairingService {
  /// Whether a device token is stored.
  Future<bool> isPaired();

  /// Asks the player for a pairing code and pairs. Returns true on success.
  Future<bool> pair();

  /// Revokes the device and forgets the token.
  Future<void> unpair();
}

/// "Appairer" opens the pairing window; the rest goes to [DevicePairing].
class WindowPairingService implements PairingService {
  WindowPairingService({required this.pairing, required this.showPairingWindow});

  final DevicePairing pairing;

  /// Shows the first-run window and completes with true once paired, false if closed.
  final Future<bool> Function() showPairingWindow;

  @override
  Future<bool> isPaired() => pairing.isPaired();

  @override
  Future<bool> pair() => showPairingWindow();

  @override
  Future<void> unpair() => pairing.unpair();
}
