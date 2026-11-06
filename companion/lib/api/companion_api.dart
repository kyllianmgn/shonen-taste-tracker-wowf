import 'api_models.dart';
import 'device_token.dart';

/// The two authenticated sends of the sync loop (docs/02 « Contrat d'échange »).
/// Implemented by `ApiClient`; the offline queue (`OfflineQueue`, C-07) wraps it.
abstract interface class CompanionApi {
  Future<HeartbeatResponse> heartbeat(DeviceToken token, HeartbeatRequest request);

  Future<SyncResponse> sync(DeviceToken token, SyncRequest request);
}
