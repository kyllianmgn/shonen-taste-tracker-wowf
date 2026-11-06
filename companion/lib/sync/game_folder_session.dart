import '../lua/normalize.dart';
import '../process/game_detector.dart';
import '../process/process_lister.dart';
import '../queue/offline_queue.dart';
import '../ui/tray/tray_state.dart' as tray;
import '../wow_files/saved_variables_discovery.dart';
import '../wow_files/saved_variables_watcher.dart';
import 'sent_state.dart';
import 'sync_engine.dart';
import 'sync_runtime.dart';

/// The real [SyncSession]: C-03 watcher and C-04 detector on [gameFolder],
/// feeding a [SyncEngine] that sends through the offline queue (C-07).
class GameFolderSyncSession implements SyncSession {
  GameFolderSyncSession({
    required String gameFolder,
    required ProcessLister processLister,
    required RequestSender sender,
    required SentStateStore sentState,
    required JsonSchema syncRequestSchema,
    required void Function(tray.TrayEvent event) emit,
    required String appVersion,
  }) : _watcher = SavedVariablesWatcher(gameFolder),
       _detector = GameDetector(lister: processLister, foreverDir: gameFolder) {
    _engine = SyncEngine(
      files: _watcher.events,
      game: _detector.events,
      sender: sender,
      sentState: sentState,
      syncRequestSchema: syncRequestSchema,
      listFiles: () => discoverSavedVariables(gameFolder),
      emit: emit,
      appVersion: appVersion,
    );
  }

  final SavedVariablesWatcher _watcher;
  final GameDetector _detector;
  late final SyncEngine _engine;

  @override
  Future<void> start() async {
    await _engine.start();
    _detector.start();
    await _watcher.start();
  }

  @override
  Future<void> stop() async {
    await _watcher.dispose();
    await _detector.dispose();
    await _engine.dispose();
  }

  @override
  Future<void> syncNow() => _engine.syncNow();
}
