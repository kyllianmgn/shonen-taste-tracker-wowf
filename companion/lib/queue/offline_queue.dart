import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:logging/logging.dart';

import '../api/api_error.dart';
import '../api/api_models.dart';
import '../api/companion_api.dart';
import '../api/device_token.dart';
import '../api/token_store.dart';
import '../ui/tray/tray_state.dart' as tray;
import 'notifier.dart';
import 'queue_store.dart';
import 'queued_request.dart';

/// What happened to a heartbeat or a sync handed to the [RequestSender].
sealed class SendOutcome<T> {
  const SendOutcome();
}

/// The server accepted it.
final class Delivered<T> extends SendOutcome<T> {
  const Delivered(this.response);
  final T response;
}

/// In the offline queue: it will be sent again, in order, until it expires.
final class Queued<T> extends SendOutcome<T> {
  const Queued();
}

/// Not sent and not queued: not paired, token revoked (401), or refused for good.
final class NotSent<T> extends SendOutcome<T> {
  const NotSent();
}

/// How the sync loop sends (implemented by [OfflineQueue]).
abstract interface class RequestSender {
  Future<SendOutcome<HeartbeatResponse>> heartbeat(HeartbeatRequest request);

  Future<SendOutcome<SyncResponse>> sync(SyncRequest request);

  /// `heartbeatIntervalSec` of every accepted request, replays included.
  Stream<int> get heartbeatIntervals;

  /// "Synchroniser maintenant": replay the queue now instead of at the next delay.
  Future<void> retryNow();
}

typedef QueueTimerFactory = Timer Function(Duration delay, void Function() callback);

Timer _oneShotTimer(Duration delay, void Function() callback) => Timer(delay, callback);

/// Offline queue (docs/01 « File hors ligne »), one for the whole app.
///
/// - A heartbeat or sync that fails with a network error, a 5xx or a 429 is
///   written to the [QueueStore] and replayed after 5 s, 30 s, 2 min, then every
///   10 min ([retryDelays]; a longer `Retry-After` wins).
/// - Send order is kept: while the queue is not empty, new requests go behind it.
/// - Heartbeats older than [heartbeatMaxAge] (30 min) and syncs older than
///   [syncMaxAge] (7 days) are dropped.
/// - A request refused for good (400, 413, 422, unexpected answer) is dropped.
/// - `401`: every send stops, the queue stays on disk, the tray turns orange and
///   one Windows notification asks to pair again; [resume] after a new pairing.
///
/// Operations run one after the other, so a replay and a new send never overlap.
class OfflineQueue implements RequestSender {
  OfflineQueue({
    required this._api,
    required this._tokens,
    required this._store,
    required this._emit,
    required this._notifier,
    this._now = DateTime.now,
    this._timer = _oneShotTimer,
    this.retryDelays = defaultRetryDelays,
    this.heartbeatMaxAge = const Duration(minutes: 30),
    this.syncMaxAge = const Duration(days: 7),
  });

  static const defaultRetryDelays = [
    Duration(seconds: 5),
    Duration(seconds: 30),
    Duration(minutes: 2),
    Duration(minutes: 10),
  ];

  static const notificationTitle = 'ForeverTracker Sync';
  static const notificationBody = "Jeton révoqué : réappaire l'appli avec /lier appli sur Discord.";

  static final _log = Logger('queue');

  final CompanionApi _api;
  final TokenStore _tokens;
  final QueueStore _store;
  final void Function(tray.TrayEvent event) _emit;
  final Notifier _notifier;
  final DateTime Function() _now;
  final QueueTimerFactory _timer;
  final List<Duration> retryDelays;
  final Duration heartbeatMaxAge;
  final Duration syncMaxAge;

  /// In send order.
  final _items = <QueuedRequest>[];
  int _nextSeq = 1;

  /// Failed attempts in a row; picks the next delay.
  int _failures = 0;
  Timer? _retryTimer;
  bool _halted = false;
  bool _disposed = false;
  Future<void> _lane = Future.value();
  final _intervals = StreamController<int>.broadcast();

  int get length => _items.length;

  /// True after a 401, until [resume].
  bool get halted => _halted;

  @override
  Stream<int> get heartbeatIntervals => _intervals.stream;

  /// Loads what the last run left on disk and replays it right away.
  Future<void> start() => _run(() async {
    try {
      _items
        ..clear()
        ..addAll(await _store.load());
    } on FileSystemException catch (e) {
      _log.warning('cannot read the queue folder (${e.osError?.message ?? e.message})');
    }
    if (_items.isEmpty) return;
    _nextSeq = _items.last.seq + 1;
    _log.info('${_items.length} request(s) left in the queue by the last run');
    await _drain();
  });

  Future<void> dispose() async {
    _disposed = true;
    _retryTimer?.cancel();
    _retryTimer = null;
    await _intervals.close();
  }

  @override
  Future<SendOutcome<HeartbeatResponse>> heartbeat(HeartbeatRequest request) => _run(
    () => _send(QueuedKind.heartbeat, request.toJson(), (token) => _api.heartbeat(token, request)),
  );

  @override
  Future<SendOutcome<SyncResponse>> sync(SyncRequest request) =>
      _run(() => _send(QueuedKind.sync, request.toJson(), (token) => _api.sync(token, request)));

  @override
  Future<void> retryNow() => _run(() async {
    if (_items.isEmpty || _halted) return;
    _log.info('replaying the queue now');
    await _drain();
  });

  /// After a new pairing: sends again, starting with what is queued.
  Future<void> resume() => _run(() async {
    _halted = false;
    _failures = 0;
    await _drain();
  });

  /// After "Délier": nothing queued must reach the server any more.
  Future<void> clear() => _run(() async {
    _retryTimer?.cancel();
    _retryTimer = null;
    _failures = 0;
    for (final r in List.of(_items)) {
      await _forget(r);
    }
    _items.clear();
    _log.info('queue emptied');
  });

  // --- Sending ---------------------------------------------------------------

  Future<SendOutcome<T>> _send<T extends Object>(
    QueuedKind kind,
    Map<String, Object?> body,
    Future<T> Function(DeviceToken token) call,
  ) async {
    if (_disposed) return NotSent<T>();
    if (_halted) {
      _log.fine('token revoked: ${kind.name} not sent');
      return NotSent<T>();
    }
    final token = await _tokens.read();
    if (token == null) {
      _log.fine('not paired: ${kind.name} not sent');
      return NotSent<T>();
    }
    if (_items.isNotEmpty) {
      await _append(kind, body);
      return Queued<T>();
    }
    try {
      final response = await call(token);
      _delivered(response);
      return Delivered<T>(response);
    } on ApiException catch (e) {
      _log.warning('${kind.name} failed: $e');
      if (e is InvalidToken) {
        await _halt();
        return NotSent<T>();
      }
      if (!e.retryable) {
        _refused(e);
        return NotSent<T>();
      }
      await _append(kind, body);
      _failures = 1;
      _emit(const tray.SendFailed());
      _scheduleRetry(e);
      return Queued<T>();
    }
  }

  /// Sends the queue head first until it is empty or a send fails.
  Future<void> _drain() async {
    _retryTimer?.cancel();
    _retryTimer = null;
    if (_disposed || _halted || _items.isEmpty) return;
    final token = await _tokens.read();
    if (token == null) {
      _log.info('not paired: ${_items.length} request(s) kept in the queue');
      return;
    }
    while (_items.isNotEmpty && !_disposed) {
      final head = _items.first;
      if (_expired(head)) {
        _log.info('$head dropped: older than ${_maxAge(head.kind).inMinutes} min');
        await _removeHead();
        continue;
      }
      try {
        final response = await _replay(head, token);
        await _removeHead();
        _failures = 0;
        _delivered(response);
        _emit(tray.SendSucceeded(_now(), isSync: head.kind == QueuedKind.sync));
        _log.info('$head sent (${_items.length} left)');
      } on FormatException catch (e) {
        _log.warning('$head dropped: unreadable body (${e.message})');
        await _removeHead();
      } on ApiException catch (e) {
        _log.warning('$head failed: $e');
        if (e is InvalidToken) {
          await _halt();
          return;
        }
        if (e.retryable) {
          _failures++;
          _emit(const tray.SendFailed());
          _scheduleRetry(e);
          return;
        }
        _log.warning('$head dropped: refused by the server');
        _refused(e);
        await _removeHead();
      }
    }
  }

  Future<Object> _replay(QueuedRequest request, DeviceToken token) => switch (request.kind) {
    QueuedKind.heartbeat => _api.heartbeat(token, HeartbeatRequest.fromJson(request.body)),
    QueuedKind.sync => _api.sync(token, SyncRequest.fromJson(request.body)),
  };

  void _scheduleRetry(ApiException e) {
    var delay = retryDelays[min(_failures, retryDelays.length) - 1];
    if (e is RateLimited) {
      final after = e.retryAfter;
      if (after != null && after > delay) delay = after;
    }
    _retryTimer?.cancel();
    _retryTimer = _timer(delay, () {
      _retryTimer = null;
      unawaited(_run(_drain));
    });
    _log.info('${_items.length} request(s) queued, next try in ${delay.inSeconds} s');
  }

  void _delivered(Object response) {
    final interval = switch (response) {
      HeartbeatResponse(:final heartbeatIntervalSec) => heartbeatIntervalSec,
      SyncResponse(:final heartbeatIntervalSec) => heartbeatIntervalSec,
      _ => null,
    };
    if (interval != null && !_intervals.isClosed) _intervals.add(interval);
  }

  /// Refused for good: only the 422 has a meaning for the player.
  void _refused(ApiException e) {
    if (e is SchemaRejected) _emit(const tray.UnknownSchema());
  }

  Future<void> _halt() async {
    _retryTimer?.cancel();
    _retryTimer = null;
    if (_halted) return;
    _halted = true;
    _log.warning('device token revoked: sends stopped until the app is paired again');
    _emit(const tray.Unauthorized());
    try {
      await _notifier.show(title: notificationTitle, body: notificationBody);
    } catch (e) {
      _log.warning('cannot show the Windows notification: ${e.runtimeType}');
    }
  }

  // --- Storage ---------------------------------------------------------------

  bool _expired(QueuedRequest r) => _now().difference(r.createdAt) > _maxAge(r.kind);

  Duration _maxAge(QueuedKind kind) => switch (kind) {
    QueuedKind.heartbeat => heartbeatMaxAge,
    QueuedKind.sync => syncMaxAge,
  };

  Future<void> _append(QueuedKind kind, Map<String, Object?> body) async {
    final request = QueuedRequest(seq: _nextSeq++, kind: kind, createdAt: _now(), body: body);
    _items.add(request);
    try {
      await _store.add(request);
    } on FileSystemException catch (e) {
      // Still replayed by this run; only a restart would lose it.
      _log.warning('cannot write $request to disk (${e.osError?.message ?? e.message})');
    }
  }

  Future<void> _removeHead() => _forget(_items.removeAt(0));

  Future<void> _forget(QueuedRequest r) async {
    try {
      await _store.remove(r.seq);
    } on FileSystemException catch (e) {
      _log.warning('cannot delete $r (${e.osError?.message ?? e.message})');
    }
  }

  Future<T> _run<T>(Future<T> Function() op) {
    final result = _lane.then((_) => op());
    _lane = result.then<void>(
      (_) {},
      onError: (Object e, StackTrace s) => _log.severe('offline queue failed', e, s),
    );
    return result;
  }
}
