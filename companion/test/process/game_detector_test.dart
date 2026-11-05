import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/process/game_detector.dart';
import 'package:forevertracker_sync/process/process_lister.dart';

const _forever = r'C:\Program Files (x86)\World of Warcraft\_forever_';
const _wow = '$_forever\\Wow.exe';

/// Returns whatever [paths] holds at the time of the call, or throws [error].
class FakeProcessLister implements ProcessLister {
  List<String> paths = const [];
  Object? error;
  int calls = 0;

  @override
  Future<List<String>> executablePaths() async {
    calls++;
    final e = error;
    if (e != null) throw e;
    return paths;
  }
}

/// Captures the periodic callback instead of scheduling a real timer.
class FakeTicker {
  Duration? interval;
  void Function(Timer)? onTick;
  bool cancelled = false;

  Timer call(Duration d, void Function(Timer) cb) {
    interval = d;
    onTick = cb;
    return _FakeTimer(this);
  }
}

class _FakeTimer implements Timer {
  _FakeTimer(this._owner);
  final FakeTicker _owner;

  @override
  void cancel() => _owner.cancelled = true;
  @override
  bool get isActive => !_owner.cancelled;
  @override
  int get tick => 0;
}

void main() {
  group('isGameExecutable', () {
    test('accepts Wow.exe and Wow-arm64.exe directly under _forever_', () {
      expect(isGameExecutable(_wow, _forever), isTrue);
      expect(isGameExecutable('$_forever\\Wow-arm64.exe', _forever), isTrue);
    });

    test('ignores case and slash style on both sides', () {
      expect(
        isGameExecutable(r'c:/program files (x86)/world of warcraft/_FOREVER_/WOW.EXE', _forever),
        isTrue,
      );
      expect(isGameExecutable(_wow, '$_forever\\'), isTrue);
      expect(isGameExecutable(_wow, _forever.toUpperCase().replaceAll(r'\', '/')), isTrue);
    });

    test('ignores the same executable outside _forever_', () {
      expect(
        isGameExecutable(r'C:\Program Files (x86)\World of Warcraft\_retail_\Wow.exe', _forever),
        isFalse,
      );
      expect(
        isGameExecutable(r'C:\Program Files (x86)\World of Warcraft\Wow.exe', _forever),
        isFalse,
      );
    });

    test('ignores a sibling folder sharing the _forever_ prefix', () {
      expect(
        isGameExecutable(
          r'C:\Program Files (x86)\World of Warcraft\_forever_old\Wow.exe',
          _forever,
        ),
        isFalse,
      );
    });

    test('ignores other executables under _forever_', () {
      expect(isGameExecutable('$_forever\\BlizzardError.exe', _forever), isFalse);
      expect(isGameExecutable('$_forever\\Wow.exe.bak', _forever), isFalse);
    });

    test('rejects paths that climb out with ..', () {
      expect(isGameExecutable('$_forever\\..\\_retail_\\Wow.exe', _forever), isFalse);
    });

    test('rejects an empty game folder', () {
      expect(isGameExecutable(r'C:\Wow.exe', ''), isFalse);
    });
  });

  group('GameDetector', () {
    late FakeProcessLister lister;
    late FakeTicker ticker;
    late GameDetector detector;
    late List<GameEvent> events;
    late StreamSubscription<GameEvent> sub;

    setUp(() {
      lister = FakeProcessLister();
      ticker = FakeTicker();
      detector = GameDetector(lister: lister, foreverDir: _forever, periodic: ticker.call);
      events = [];
      sub = detector.events.listen(events.add);
    });

    tearDown(() async {
      await sub.cancel();
      await detector.dispose();
    });

    Future<void> flush() => Future<void>.delayed(Duration.zero);

    test('polls every 5 seconds by default', () {
      detector.start();
      expect(ticker.interval, const Duration(seconds: 5));
    });

    test('emits GameStarted then GameStopped once each, without repetition', () async {
      lister.paths = [r'C:\Windows\explorer.exe'];
      await detector.checkNow();
      lister.paths = [r'C:\Windows\explorer.exe', _wow];
      await detector.checkNow();
      await detector.checkNow();
      expect(detector.isRunning, isTrue);
      lister.paths = [r'C:\Windows\explorer.exe'];
      await detector.checkNow();
      await detector.checkNow();
      lister.paths = [_wow];
      await detector.checkNow();
      await flush();

      expect(events, [isA<GameStarted>(), isA<GameStopped>(), isA<GameStarted>()]);
    });

    test('stays silent when the game is stopped at startup', () async {
      await detector.checkNow();
      await flush();
      expect(events, isEmpty);
      expect(detector.isRunning, isFalse);
    });

    test('emits GameStarted on the first check when the game already runs', () async {
      lister.paths = [_wow];
      detector.start();
      await flush();
      await flush();
      expect(events, [isA<GameStarted>()]);
    });

    test('ignores Wow.exe running outside _forever_', () async {
      lister.paths = [r'D:\Games\World of Warcraft\_retail_\Wow.exe'];
      await detector.checkNow();
      await flush();
      expect(events, isEmpty);
      expect(detector.isRunning, isFalse);
    });

    test('a failing lister keeps the last state instead of reporting a stop', () async {
      lister.paths = [_wow];
      await detector.checkNow();
      lister.error = Exception('access denied');
      await detector.checkNow();
      await flush();
      expect(events, [isA<GameStarted>()]);
      expect(detector.isRunning, isTrue);
    });

    test('each tick runs a check', () async {
      detector.start();
      await flush();
      final before = lister.calls;
      lister.paths = [_wow];
      ticker.onTick!(_FakeTimer(ticker));
      await flush();
      await flush();
      expect(lister.calls, before + 1);
      expect(events, [isA<GameStarted>()]);
    });

    test('a tick is skipped while the previous check is still running', () async {
      final slow = Completer<List<String>>();
      final slowLister = _SlowLister(slow.future);
      final d = GameDetector(lister: slowLister, foreverDir: _forever, periodic: ticker.call);
      d.start();
      ticker.onTick!(_FakeTimer(ticker));
      ticker.onTick!(_FakeTimer(ticker));
      expect(slowLister.calls, 1);
      slow.complete(const []);
      await flush();
      await d.dispose();
    });

    test('dispose cancels the timer and closes the stream', () async {
      detector.start();
      final done = detector.events.isEmpty; // completes when the stream closes
      await sub.cancel();
      await detector.dispose();
      expect(ticker.cancelled, isTrue);
      expect(await done, isTrue);
    });
  });
}

class _SlowLister implements ProcessLister {
  _SlowLister(this._result);
  final Future<List<String>> _result;
  int calls = 0;

  @override
  Future<List<String>> executablePaths() {
    calls++;
    return _result;
  }
}
