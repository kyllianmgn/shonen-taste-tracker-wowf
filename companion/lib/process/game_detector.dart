import 'dart:async';

import 'package:logging/logging.dart';

import 'process_lister.dart';

/// Executable names the Forever client may run under. To confirm on a real install
/// (docs/01 « Détection du jeu »): any other `.exe` seen under `_forever_` is logged once.
const gameExecutableNames = {'wow.exe', 'wow-arm64.exe'};

sealed class GameEvent {
  const GameEvent();
}

final class GameStarted extends GameEvent {
  const GameStarted();
}

final class GameStopped extends GameEvent {
  const GameStopped();
}

typedef PeriodicTimerFactory = Timer Function(Duration interval, void Function(Timer) onTick);

String _normalize(String path) {
  var p = path.replaceAll('/', r'\').toLowerCase();
  while (p.endsWith(r'\')) {
    p = p.substring(0, p.length - 1);
  }
  return p;
}

bool _climbs(String normalizedPath) =>
    normalizedPath.split(r'\').any((segment) => segment == '..' || segment == '.');

/// Path of [exePath] relative to [foreverDir], or null when it is not inside it.
String? _relativeTo(String exePath, String foreverDir) {
  final dir = _normalize(foreverDir);
  final exe = _normalize(exePath);
  if (dir.isEmpty || _climbs(exe) || !exe.startsWith('$dir\\')) return null;
  return exe.substring(dir.length + 1);
}

String _basename(String normalizedPath) => normalizedPath.split(r'\').last;

/// True when [exePath] is a game executable located under [foreverDir] (any depth).
/// Case and slash style are ignored on both sides.
bool isGameExecutable(String exePath, String foreverDir) {
  final rel = _relativeTo(exePath, foreverDir);
  return rel != null && gameExecutableNames.contains(_basename(rel));
}

/// Polls [ProcessLister] and emits [GameStarted] / [GameStopped] on state changes only.
///
/// The initial state is "stopped": a game already running on the first check emits
/// [GameStarted], a stopped game emits nothing. A failing check keeps the last state.
class GameDetector {
  GameDetector({
    required this._lister,
    required this._foreverDir,
    this._interval = const Duration(seconds: 5),
    this._periodic = Timer.periodic,
  });

  static final _log = Logger('process');

  final ProcessLister _lister;
  final String _foreverDir;
  final Duration _interval;
  final PeriodicTimerFactory _periodic;
  final _events = StreamController<GameEvent>.broadcast();
  final _loggedNames = <String>{};

  Timer? _timer;
  bool _running = false;
  bool _checking = false;
  bool _disposed = false;

  Stream<GameEvent> get events => _events.stream;

  bool get isRunning => _running;

  /// Checks immediately, then every interval. Calling it twice has no effect.
  void start() {
    if (_timer != null || _disposed) return;
    _timer = _periodic(_interval, (_) => _tick());
    _tick();
  }

  void _tick() {
    if (_checking) return;
    unawaited(checkNow());
  }

  /// Runs one check and emits an event if the state changed.
  Future<void> checkNow() async {
    if (_disposed) return;
    _checking = true;
    try {
      final List<String> paths;
      try {
        paths = await _lister.executablePaths();
      } catch (e) {
        _log.warning('process listing failed (${e.runtimeType}), keeping last state');
        return;
      }
      if (_disposed) return;
      _logUnknownExecutables(paths);
      final running = paths.any((p) => isGameExecutable(p, _foreverDir));
      if (running == _running) return;
      _running = running;
      _log.info(running ? 'game started' : 'game stopped');
      _events.add(running ? const GameStarted() : const GameStopped());
    } finally {
      _checking = false;
    }
  }

  /// Helps confirm the real executable name: logs each other `.exe` under `_forever_` once,
  /// by file name only.
  void _logUnknownExecutables(List<String> paths) {
    for (final p in paths) {
      final rel = _relativeTo(p, _foreverDir);
      if (rel == null) continue;
      final name = _basename(rel);
      if (gameExecutableNames.contains(name) || !_loggedNames.add(name)) continue;
      _log.info('other executable running under _forever_: $name');
    }
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _timer?.cancel();
    await _events.close();
  }
}
