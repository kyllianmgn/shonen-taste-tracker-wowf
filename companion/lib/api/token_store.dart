import 'device_token.dart';

/// Where the device token lives. Never `settings.json`, never the logs.
abstract interface class TokenStore {
  /// The stored token, or null when the app is not paired.
  Future<DeviceToken?> read();

  Future<void> write(DeviceToken token);

  /// Forgets the token; no error when none is stored.
  Future<void> delete();
}

class TokenStoreException implements Exception {
  const TokenStoreException(this.operation, this.win32Error);

  final String operation;
  final int win32Error;

  @override
  String toString() => 'TokenStoreException($operation failed, Win32 error $win32Error)';
}
