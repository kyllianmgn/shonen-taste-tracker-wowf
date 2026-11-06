import 'dart:async';

import 'package:logging/logging.dart';

import 'sync_service.dart';

/// Watcher, game detector and [SyncEngine] for one `_forever_` folder.
abstract interface class SyncSession {
  Future<void> start();

  Future<void> stop();

  Future<void> syncNow();
}

/// Keeps one [SyncSession] for the game folder of the settings, replaced when
/// the folder changes (first-run window, "Appairer"). Operations run one after
/// the other, so a sync asked during a change reaches the new session.
class SyncRuntime implements SyncService {
  SyncRuntime(this._build);

  final SyncSession Function(String gameFolder) _build;

  static final _log = Logger('sync');

  SyncSession? _session;
  String? _folder;
  Future<void> _queue = Future.value();

  Future<void> setGameFolder(String? folder) => _run(() async {
    if (folder?.toLowerCase() == _folder?.toLowerCase()) return;
    await _session?.stop();
    _session = null;
    _folder = folder;
    if (folder == null) return;
    final session = _build(folder);
    await session.start();
    _session = session;
  });

  @override
  Future<void> syncNow() => _run(() async {
    final session = _session;
    if (session == null) {
      _log.info('sync requested but no game folder is set');
      return;
    }
    await session.syncNow();
  });

  Future<void> dispose() => setGameFolder(null);

  Future<void> _run(Future<void> Function() op) {
    final next = _queue.then((_) => op());
    _queue = next.catchError((Object e, StackTrace s) => _log.severe('sync runtime failed', e, s));
    return next;
  }
}
