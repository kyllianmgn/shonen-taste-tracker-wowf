import 'package:forevertracker_sync/api/device_token.dart';
import 'package:forevertracker_sync/api/token_store.dart';

class MemoryTokenStore implements TokenStore {
  DeviceToken? token;
  int writes = 0;

  @override
  Future<DeviceToken?> read() async => token;

  @override
  Future<void> write(DeviceToken value) async {
    writes++;
    token = value;
  }

  @override
  Future<void> delete() async => token = null;
}
