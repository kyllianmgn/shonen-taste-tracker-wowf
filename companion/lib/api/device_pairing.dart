import 'package:logging/logging.dart';

import 'api_client.dart';
import 'api_error.dart';
import 'api_models.dart';
import 'device_token.dart';
import 'token_store.dart';

/// Pairing codes from `/lier appli`: 8 characters, no 0/O nor 1/I (`pair.request.json`).
final _codePattern = RegExp(r'^[A-HJ-NP-Z2-9]{8}$');

/// What the player typed, uppercased without spaces nor dashes; null when it
/// cannot be a pairing code.
String? normalizePairingCode(String input) {
  final code = input.replaceAll(RegExp(r'[\s-]'), '').toUpperCase();
  return _codePattern.hasMatch(code) ? code : null;
}

/// `deviceName` for the pairing request: the host name, at most 64 characters.
String deviceNameFor(String hostname) {
  final name = hostname.trim();
  if (name.isEmpty) return 'PC Windows';
  return name.length <= 64 ? name : name.substring(0, 64);
}

/// Owns the device token: pairs, exposes the token to the senders (C-06), unpairs.
class DevicePairing {
  DevicePairing({
    required this._client,
    required this._store,
    required this.deviceName,
    required this.appVersion,
  });

  final ApiClient _client;
  final TokenStore _store;
  final String deviceName;
  final String appVersion;

  static final _log = Logger('pairing');

  /// The token for `Authorization: Bearer`, or null when not paired.
  Future<DeviceToken?> token() => _store.read();

  /// False as well when the token store cannot be read: the player can pair again.
  Future<bool> isPaired() async {
    try {
      return await _store.read() != null;
    } on TokenStoreException catch (e) {
      _log.warning('cannot read the device token: $e');
      return false;
    }
  }

  /// Pairs with the code typed by the player and stores the token.
  /// Throws [ArgumentError] for a malformed code (nothing sent) and [ApiException]
  /// when the server refuses; nothing is stored then.
  Future<PairResponse> pairWithCode(String input) async {
    final code = normalizePairingCode(input);
    if (code == null) throw ArgumentError('malformed pairing code');
    final response = await _client.pair(
      PairRequest(code: code, deviceName: deviceName, appVersion: appVersion),
    );
    await _store.write(response.deviceToken);
    _log.info('paired as device ${response.deviceId}');
    return response;
  }

  /// "Délier": revokes the device on the server, then forgets the token. The
  /// local token is forgotten even when the server cannot be reached.
  Future<void> unpair() async {
    final token = await _store.read();
    if (token == null) return;
    try {
      await _client.deleteDevice(token);
    } on ApiException catch (e) {
      _log.warning('server-side unpair failed ($e); forgetting the token anyway');
    }
    await _store.delete();
    _log.info('unpaired');
  }
}
