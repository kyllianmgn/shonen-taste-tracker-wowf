import 'dart:async';
import 'dart:io';

import 'package:logging/logging.dart';

import 'paths.dart';
import 'saved_variables_discovery.dart';

/// A SavedVariables file finished being written and can be read.
class FileReady {
  const FileReady(this.path);

  final String path;

  @override
  bool operator ==(Object other) => other is FileReady && other.path == path;

  @override
  int get hashCode => path.hashCode;

  @override
  String toString() => 'FileReady($path)';
}

/// Watches every account's `ForeverTracker.lua` under a `_forever_` folder
/// (spec docs/01, "Lecture du fichier").
///
/// Two sources of change: the OS watcher on `_forever_\WTF` (recursive), and a
/// poll every [pollInterval] that re-lists the accounts and compares size and
/// modification date. A change is emitted as [FileReady] only once size and date
/// have stayed the same for [stableFor], because the game writes in several parts.
///
/// Files already present when [start] runs are emitted once. A file is not
/// emitted again until its size or date changes, or it is deleted and recreated.
class SavedVariablesWatcher {
  SavedVariablesWatcher(
    this.foreverPath, {
    this.pollInterval = const Duration(seconds: 10),
    this.stableFor = const Duration(seconds: 2),
    this.stabilityCheckInterval = const Duration(milliseconds: 250),
    this.useSystemWatcher = true,
  });

  final String foreverPath;
  final Duration pollInterval;
  final Duration stableFor;
  final Duration stabilityCheckInterval;

  /// False to rely on polling only.
  final bool useSystemWatcher;

  static final _log = Logger('wow_files');

  final _controller = StreamController<FileReady>.broadcast();

  /// Keyed by lower-cased path: Windows paths are case-insensitive.
  final _emitted = <String, _Signature>{};
  final _pending = <String, _Pending>{};

  Timer? _pollTimer;
  StreamSubscription<FileSystemEvent>? _systemWatch;
  bool _running = false;
  bool _polling = false;

  Stream<FileReady> get events => _controller.stream;

  Future<void> start() async {
    if (_running) return;
    _running = true;
    _pollTimer = Timer.periodic(pollInterval, (_) => _poll());
    await _poll();
  }

  /// Stops watching and forgets pending changes. [start] can be called again.
  Future<void> stop() async {
    _running = false;
    _pollTimer?.cancel();
    _pollTimer = null;
    await _dropSystemWatcher();
    for (final pending in _pending.values) {
      pending.timer.cancel();
    }
    _pending.clear();
  }

  Future<void> dispose() async {
    await stop();
    await _controller.close();
  }

  Future<void> _poll() async {
    if (!_running || _polling) return;
    _polling = true;
    try {
      _ensureSystemWatcher();
      final files = await discoverSavedVariables(foreverPath);
      if (!_running) return;
      final present = files.map((f) => f.toLowerCase()).toSet();
      for (final key in {..._emitted.keys, ..._pending.keys}) {
        if (!present.contains(key)) _forget(key);
      }
      for (final file in files) {
        await _consider(file);
      }
    } finally {
      _polling = false;
    }
  }

  /// (Re)starts the OS watcher; called on every poll so it comes back once
  /// `WTF` exists again or after the watcher failed.
  void _ensureSystemWatcher() {
    if (!useSystemWatcher || _systemWatch != null) return;
    final wtf = Directory(joinPath([trimTrailingSeparators(foreverPath), 'WTF']));
    if (!wtf.existsSync()) return;
    try {
      _systemWatch = wtf
          .watch(recursive: true)
          .listen(
            _onSystemEvent,
            onError: (Object e) {
              _log.warning('system watcher failed, polling only until next poll: $e');
              _dropSystemWatcher();
            },
            onDone: _dropSystemWatcher,
          );
    } on FileSystemException catch (e) {
      _log.warning('cannot start system watcher, polling only: ${e.message}');
    }
  }

  Future<void> _dropSystemWatcher() async {
    final watch = _systemWatch;
    _systemWatch = null;
    await watch?.cancel();
  }

  void _onSystemEvent(FileSystemEvent event) {
    final paths = [
      event.path,
      if (event is FileSystemMoveEvent && event.destination != null) event.destination!,
    ];
    for (final path in paths) {
      if (isSavedVariablesFile(foreverPath, path)) _consider(path);
    }
  }

  /// Starts a stability wait for [path] unless it is already waiting or
  /// unchanged since it was last emitted.
  Future<void> _consider(String path) async {
    final key = path.toLowerCase();
    final signature = await _Signature.of(path);
    if (!_running) return;
    if (signature == null) {
      _forget(key);
      return;
    }
    if (_pending.containsKey(key) || _emitted[key] == signature) return;
    _pending[key] = _Pending(
      path,
      signature,
      Timer.periodic(stabilityCheckInterval, (_) => _checkStability(key)),
    );
  }

  Future<void> _checkStability(String key) async {
    final pending = _pending[key];
    if (pending == null || pending.checking) return;
    pending.checking = true;
    try {
      final signature = await _Signature.of(pending.path);
      if (!identical(_pending[key], pending)) return;
      if (signature == null) {
        _forget(key);
      } else if (signature != pending.signature) {
        pending.restart(signature);
      } else if (pending.stableFor.elapsed >= stableFor) {
        pending.timer.cancel();
        _pending.remove(key);
        if (_emitted[key] != signature) {
          _emitted[key] = signature;
          _log.fine('SavedVariables ready: ${pending.path}');
          _controller.add(FileReady(pending.path));
        }
      }
    } finally {
      pending.checking = false;
    }
  }

  /// The file is gone: drop any wait, and emit it again once it comes back.
  void _forget(String key) {
    _pending.remove(key)?.timer.cancel();
    _emitted.remove(key);
  }
}

class _Signature {
  const _Signature(this.size, this.modified);

  final int size;
  final DateTime modified;

  /// Null when the file does not exist (or is not a file).
  static Future<_Signature?> of(String path) async {
    final stat = await FileStat.stat(path);
    if (stat.type != FileSystemEntityType.file) return null;
    return _Signature(stat.size, stat.modified);
  }

  @override
  bool operator ==(Object other) =>
      other is _Signature && other.size == size && other.modified == modified;

  @override
  int get hashCode => Object.hash(size, modified);
}

class _Pending {
  _Pending(this.path, this.signature, this.timer) {
    stableFor.start();
  }

  final String path;
  final Timer timer;
  final stableFor = Stopwatch();
  _Signature signature;
  bool checking = false;

  void restart(_Signature next) {
    signature = next;
    stableFor
      ..reset()
      ..start();
  }
}
