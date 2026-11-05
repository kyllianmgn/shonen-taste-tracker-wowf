import 'package:logging/logging.dart';

/// Reads the SavedVariables files and sends what changed, implemented in C-06.
abstract interface class SyncService {
  /// "Synchroniser maintenant": re-read the files and send them again.
  Future<void> syncNow();
}

/// Placeholder until C-06.
class NotImplementedSyncService implements SyncService {
  static final _log = Logger('sync');

  @override
  Future<void> syncNow() async => _log.info('syncNow: not implemented yet (C-06)');
}
