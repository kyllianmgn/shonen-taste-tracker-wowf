import 'dart:async';
import 'dart:io';

import 'package:logging/logging.dart';

import '../api/api_error.dart';
import '../api/api_models.dart';
import '../api/companion_api.dart';
import '../api/token_store.dart';
import '../lua/lua_parser.dart';
import '../lua/normalize.dart';
import '../lua/saved_variables.dart';
import '../process/game_detector.dart';
import '../ui/tray/tray_state.dart' as tray;
import '../wow_files/saved_variables_watcher.dart';
import 'sent_state.dart';
import 'sync_plan.dart';
import 'sync_service.dart';

/// SavedVariables `schema` values this build understands (docs/01).
const knownSavedVariablesSchemas = {1};

typedef OneShotTimerFactory = Timer Function(Duration delay, void Function() callback);

Future<List<int>> _readFileBytes(String path) => File(path).readAsBytes();

Timer _oneShotTimer(Duration delay, void Function() callback) => Timer(delay, callback);

/// Turns game and file events into heartbeats and syncs (docs/01 « Envois »,
/// « Lecture du fichier », « Détection du jeu »).
///
/// - Heartbeat right away on [GameStarted] and [GameStopped], then every
///   `heartbeatIntervalSec` (last value returned by the server) while the game runs.
///   It carries the character of the most recent `SESSION_START` seen.
/// - [FileReady]: parse the file, send what [planCharacters] keeps; at most one
///   sync every [minSyncInterval], later changes wait for the next slot. One sync
///   carries one file (one account).
/// - After [GameStopped], if no file is rewritten within [finalSyncWait], every
///   file is read again for the final sync.
/// - Unknown `schema`: nothing sent, [tray.UnknownSchema].
///
/// Sent state is saved only once the server accepted the sync, so a failed sync
/// goes out again on the next change (the offline queue comes with C-07).
class SyncEngine implements SyncService {
  SyncEngine({
    required this._files,
    required this._game,
    required this._api,
    required this._tokens,
    required SentStateStore sentState,
    required JsonSchema syncRequestSchema,
    required this._listFiles,
    required this._emit,
    required this._appVersion,
    this._readFile = _readFileBytes,
    this._now = DateTime.now,
    this._timer = _oneShotTimer,
    this.minSyncInterval = const Duration(seconds: 30),
    this.finalSyncWait = const Duration(seconds: 60),
    this._heartbeatIntervalSec = 600,
  }) : _store = sentState,
       _schema = syncRequestSchema;

  static final _log = Logger('sync');

  final Stream<FileReady> _files;
  final Stream<GameEvent> _game;
  final CompanionApi _api;
  final TokenStore _tokens;
  final SentStateStore _store;
  final JsonSchema _schema;
  final Future<List<String>> Function() _listFiles;
  final void Function(tray.TrayEvent event) _emit;
  final String _appVersion;
  final Future<List<int>> Function(String path) _readFile;
  final DateTime Function() _now;
  final OneShotTimerFactory _timer;
  final Duration minSyncInterval;
  final Duration finalSyncWait;

  int _heartbeatIntervalSec;
  SentState _sent = SentState();
  final List<StreamSubscription<Object>> _subscriptions = [];
  bool _disposed = false;

  /// Files waiting for a sync slot, keyed by lower-cased path, in arrival order.
  final _pending = <String, ({String path, bool force})>{};
  DateTime? _lastSyncAt;
  Timer? _flushTimer;
  bool _flushing = false;

  bool _gameRunning = false;

  /// Bumped on each game state change so a stale heartbeat does not reschedule.
  int _gameGeneration = 0;
  Timer? _heartbeatTimer;
  Timer? _finalSyncTimer;
  ({int at, CharacterRef character})? _lastSession;

  /// Loads the sent state and listens to the streams. Start the watcher and
  /// the game detector after this.
  Future<void> start() async {
    _sent = await _store.load();
    if (_disposed) return;
    _subscriptions
      ..add(_files.listen(_onFileReady))
      ..add(_game.listen(_onGameEvent));
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _flushTimer?.cancel();
    _heartbeatTimer?.cancel();
    _finalSyncTimer?.cancel();
    for (final s in _subscriptions) {
      await s.cancel();
    }
    _subscriptions.clear();
  }

  /// "Synchroniser maintenant": re-reads every file and sends it all again,
  /// still at most one sync every [minSyncInterval].
  @override
  Future<void> syncNow() async {
    _log.info('sync requested from the tray');
    for (final path in await _allFiles()) {
      _enqueue(path, force: true);
    }
  }

  // --- Files and syncs -------------------------------------------------------

  void _onFileReady(FileReady event) {
    // The game rewrote a file after it stopped: this is the final sync.
    _finalSyncTimer?.cancel();
    _finalSyncTimer = null;
    _enqueue(event.path, force: false);
  }

  Future<List<String>> _allFiles() async {
    try {
      return await _listFiles();
    } on FileSystemException catch (e) {
      _log.warning('cannot list SavedVariables files: ${e.osError?.message ?? e.message}');
      return const [];
    }
  }

  void _enqueue(String path, {required bool force}) {
    if (_disposed) return;
    final key = path.toLowerCase();
    final previous = _pending[key];
    _pending[key] = (path: path, force: force || (previous?.force ?? false));
    _scheduleFlush();
  }

  void _scheduleFlush() {
    if (_disposed || _flushing || _pending.isEmpty || (_flushTimer?.isActive ?? false)) return;
    final last = _lastSyncAt;
    final wait = last == null ? Duration.zero : last.add(minSyncInterval).difference(_now());
    if (wait <= Duration.zero) {
      unawaited(_flush());
    } else {
      _flushTimer = _timer(wait, () {
        _flushTimer = null;
        unawaited(_flush());
      });
    }
  }

  /// Sends the first pending file that has something new, then waits for the next slot.
  Future<void> _flush() async {
    if (_flushing || _disposed) return;
    _flushing = true;
    try {
      while (_pending.isNotEmpty && !_disposed) {
        final key = _pending.keys.first;
        final file = _pending.remove(key)!;
        final request = await _prepare(file.path, force: file.force);
        if (request == null) continue;
        await _sendSync(request);
        break;
      }
    } finally {
      _flushing = false;
    }
    _scheduleFlush();
  }

  /// Reads and parses [path]; null when there is nothing to send.
  Future<SyncRequest?> _prepare(String path, {required bool force}) async {
    final SavedVariablesData? data;
    try {
      data = parseSavedVariablesBytes(await _readFile(path), _schema);
    } on LuaParseError catch (e) {
      _log.warning('SavedVariables file rejected, nothing sent: $e');
      return null;
    } on FileSystemException catch (e) {
      _log.warning('cannot read SavedVariables file: ${e.osError?.message ?? e.message}');
      return null;
    }
    if (data == null) return null;

    final schema = data.schema;
    if (schema is! int || !knownSavedVariablesSchemas.contains(schema)) {
      _log.warning('unknown SavedVariables schema "$schema": nothing sent, update the app');
      _emit(const tray.UnknownSchema());
      return null;
    }

    final session = lastSessionStart(data.characters);
    final known = _lastSession;
    if (session != null && (known == null || session.at > known.at)) _lastSession = session;

    final characters = planCharacters(data.characters, _sent, force: force);
    if (characters.isEmpty) {
      _log.fine('nothing new to send');
      return null;
    }
    final addonVersion = data.addonVersion;
    return SyncRequest(
      sentAt: _unixNow(),
      schema: schema,
      addonVersion: addonVersion is String ? addonVersion : 'unknown',
      characters: characters,
    );
  }

  Future<void> _sendSync(SyncRequest request) async {
    final token = await _tokens.read();
    if (token == null) {
      _log.info('not paired: sync skipped');
      return;
    }
    _lastSyncAt = _now();
    try {
      final response = await _api.sync(token, request);
      _heartbeatIntervalSec = response.heartbeatIntervalSec;
      _sent.markSent(request.characters);
      await _saveSentState();
      _logResults(response);
      _emit(tray.SendSucceeded(_now(), isSync: true, character: _lastCharacterName));
    } on ApiException catch (e) {
      _onApiError('sync', e);
    }
  }

  Future<void> _saveSentState() async {
    try {
      await _store.save(_sent);
    } on FileSystemException catch (e) {
      _log.warning('cannot save sync-state.json: ${e.osError?.message ?? e.message}');
    }
  }

  void _logResults(SyncResponse response) {
    var accepted = 0;
    var duplicates = 0;
    for (final r in response.results) {
      accepted += r.acceptedEvents;
      duplicates += r.duplicateEvents;
      if (r.status != SyncStatus.ok || r.flags.isNotEmpty) {
        _log.warning('sync: ${r.key} ${r.status.wire} ${r.flags}');
      }
    }
    _log.info(
      'sync ok: ${response.results.length} character(s), '
      '$accepted event(s) accepted, $duplicates duplicate(s)',
    );
  }

  // --- Game state and heartbeats ---------------------------------------------

  void _onGameEvent(GameEvent event) {
    final running = event is GameStarted;
    _gameRunning = running;
    final generation = ++_gameGeneration;
    _heartbeatTimer?.cancel();
    _emit(running ? const tray.GameStarted() : const tray.GameStopped());
    unawaited(_heartbeat(generation, running));
    if (!running) {
      _finalSyncTimer?.cancel();
      _finalSyncTimer = _timer(finalSyncWait, _finalSync);
    }
  }

  /// No file rewritten since the game stopped: read them all once more.
  Future<void> _finalSync() async {
    _finalSyncTimer = null;
    _log.info('no SavedVariables rewrite within ${finalSyncWait.inSeconds} s, final sync');
    for (final path in await _allFiles()) {
      _enqueue(path, force: false);
    }
  }

  Future<void> _heartbeat(int generation, bool running) async {
    final token = await _tokens.read();
    if (_disposed) return;
    if (token == null) {
      _log.fine('not paired: heartbeat skipped');
    } else {
      try {
        final response = await _api.heartbeat(
          token,
          HeartbeatRequest(
            sentAt: _unixNow(),
            gameRunning: running,
            appVersion: _appVersion,
            lastCharacter: _lastSession?.character,
          ),
        );
        _heartbeatIntervalSec = response.heartbeatIntervalSec;
        _emit(tray.SendSucceeded(_now(), character: _lastCharacterName));
      } on ApiException catch (e) {
        _onApiError('heartbeat', e);
      }
    }
    if (_disposed || generation != _gameGeneration || !_gameRunning) return;
    _heartbeatTimer?.cancel();
    _heartbeatTimer = _timer(
      Duration(seconds: _heartbeatIntervalSec),
      () => unawaited(_heartbeat(generation, true)),
    );
  }

  // --- Shared ----------------------------------------------------------------

  void _onApiError(String what, ApiException e) {
    _log.warning('$what failed: $e');
    switch (e) {
      case InvalidToken():
        _emit(const tray.Unauthorized());
      case SchemaRejected():
        _emit(const tray.UnknownSchema());
      case _ when e.retryable:
        _emit(const tray.SendFailed());
      default:
        break;
    }
  }

  String? get _lastCharacterName {
    final c = _lastSession?.character;
    return c == null ? null : '${c.firstName} ${c.surname}';
  }

  int _unixNow() => _now().millisecondsSinceEpoch ~/ 1000;
}
