/// Reads the SavedVariables files and sends what changed (`SyncRuntime`, `SyncEngine`).
abstract interface class SyncService {
  /// "Synchroniser maintenant": re-read the files and send them again.
  Future<void> syncNow();
}
