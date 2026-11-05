import 'package:logging/logging.dart';

/// Device pairing with the server (`POST /v1/devices/pair`), implemented in C-05.
abstract interface class PairingService {
  /// Whether a device token is stored.
  Future<bool> isPaired();

  /// Asks the user for a pairing code and pairs. Returns true on success.
  Future<bool> pair();

  /// Forgets the device token.
  Future<void> unpair();
}

/// Placeholder until C-05.
class NotImplementedPairingService implements PairingService {
  static final _log = Logger('pairing');

  @override
  Future<bool> isPaired() async => false;

  @override
  Future<bool> pair() async {
    _log.info('pair: not implemented yet (C-05)');
    return false;
  }

  @override
  Future<void> unpair() async => _log.info('unpair: not implemented yet (C-05)');
}
