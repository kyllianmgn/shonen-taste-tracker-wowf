import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/api_error.dart';
import 'package:forevertracker_sync/api/api_models.dart';
import 'package:forevertracker_sync/api/device_token.dart';
import 'package:forevertracker_sync/process/game_detector.dart';
import 'package:forevertracker_sync/queue/offline_queue.dart';
import 'package:forevertracker_sync/sync/sent_state.dart';
import 'package:forevertracker_sync/sync/sync_engine.dart';
import 'package:forevertracker_sync/ui/tray/tray_state.dart' as tray;
import 'package:forevertracker_sync/wow_files/saved_variables_watcher.dart';

import '../support/contract.dart';
import '../support/fake_clock.dart';
import '../support/fake_companion_api.dart';
import '../support/memory_queue_store.dart';
import '../support/memory_token_store.dart';
import '../support/saved_variables_builder.dart';

const _fileA = r'C:\WoW\_forever_\WTF\Account\ACC1\SavedVariables\ForeverTracker.lua';
const _fileB = r'C:\WoW\_forever_\WTF\Account\ACC2\SavedVariables\ForeverTracker.lua';
const _guid = 'Player-4242-0A1B2C3D';

class MemorySentStateStore implements SentStateStore {
  Map<String, Object?>? saved;

  @override
  Future<SentState> load() async {
    final s = saved;
    return s == null ? SentState() : SentState.fromJson(s);
  }

  @override
  Future<void> save(SentState state) async => saved = state.toJson();
}

class Harness {
  Harness() {
    api = FakeCompanionApi(clock);
  }

  final clock = FakeClock();
  late final FakeCompanionApi api;
  final tokens = MemoryTokenStore()..token = const DeviceToken('tok');
  final store = MemorySentStateStore();
  final queueStore = MemoryQueueStore();
  final notifier = RecordingNotifier();
  late OfflineQueue queue;
  final files = <String, String>{};
  final fileEvents = StreamController<FileReady>.broadcast();
  final gameEvents = StreamController<GameEvent>.broadcast();
  final tray_ = <tray.TrayEvent>[];
  late SyncEngine engine;

  int get unix => clock.now().millisecondsSinceEpoch ~/ 1000;

  /// The tray state machine fed with every event so far.
  tray.TrayState get trayState =>
      tray_.fold(const tray.TrayState(paired: true), (state, e) => state.apply(e));

  Future<void> start() async {
    queue = OfflineQueue(
      api: api,
      tokens: tokens,
      store: queueStore,
      emit: tray_.add,
      notifier: notifier,
      now: clock.now,
      timer: clock.timer,
    );
    await queue.start();
    engine = SyncEngine(
      files: fileEvents.stream,
      game: gameEvents.stream,
      sender: queue,
      sentState: store,
      syncRequestSchema: contractSchemaJson('sync.request'),
      listFiles: () async => files.keys.toList(),
      readFile: (path) async {
        final content = files[path];
        if (content == null) throw StateError('no file $path');
        return utf8.encode(content);
      },
      emit: tray_.add,
      appVersion: '1.0.0',
      now: clock.now,
      timer: clock.timer,
    );
    await engine.start();
    await settle();
  }

  /// The game rewrote [path] and the watcher saw it settle.
  Future<void> write(String path, List<TestCharacter> chars, {Object schema = 1}) async {
    files[path] = savedVariablesLua(chars, schema: schema);
    fileEvents.add(FileReady(path));
    await settle();
  }

  Future<void> game(GameEvent e) async {
    gameEvents.add(e);
    await settle();
  }

  Future<void> dispose() async {
    await engine.dispose();
    await queue.dispose();
    await fileEvents.close();
    await gameEvents.close();
  }
}

TestEvent _ev(String type, int at, int n) => TestEvent('$_guid-$at-$n', type, at, {'level': 1});

void main() {
  late Harness h;

  setUp(() => h = Harness());
  tearDown(() => h.dispose());

  test('full scenario: launch, level up, quit', () async {
    await h.start();
    final t0 = h.unix;
    final login = _ev('SESSION_START', t0, 1);
    var davina = TestCharacter(capturedAt: t0 - 3600, level: 22);

    // The file already on disk at startup is emitted once by the watcher.
    await h.write(_fileA, [davina]);
    expect(h.api.syncs, hasLength(1));
    expect(h.api.sentEventIds, isEmpty);

    // Launch: immediate heartbeat.
    await h.game(const GameStarted());
    expect(h.api.heartbeats, hasLength(1));
    expect(h.api.heartbeats.single.gameRunning, isTrue);
    expect(h.tray_.whereType<tray.GameStarted>(), hasLength(1));

    // A first /reload writes the login.
    await h.clock.elapse(const Duration(seconds: 40));
    davina = davina.copyWith(capturedAt: t0 + 40, events: [login]);
    await h.write(_fileA, [davina]);
    expect(h.api.syncs, hasLength(2));
    expect(h.api.sentEventIds, [login.id]);

    // Next heartbeat 600 s after the first one, now with the last character.
    await h.clock.elapse(const Duration(seconds: 560));
    expect(h.api.heartbeats, hasLength(2));
    expect(
      h.api.heartbeats.last.lastCharacter,
      const CharacterRef(region: 'eu', firstName: 'Davina', surname: 'Asaria'),
    );

    // Level up, then the player clicks "Synchroniser" (/reload).
    await h.clock.elapse(const Duration(seconds: 100));
    final levelUp = _ev('LEVEL_UP', h.unix, 2);
    final reloadEnd = _ev('SESSION_END', h.unix + 1, 3);
    final reloadStart = _ev('SESSION_START', h.unix + 2, 4);
    davina = davina.copyWith(
      capturedAt: h.unix + 2,
      level: 23,
      events: [login, levelUp, reloadEnd, reloadStart],
    );
    await h.write(_fileA, [davina]);
    expect(h.api.syncs, hasLength(3));
    expect(h.api.sentEventIds.skip(1), [levelUp.id, reloadEnd.id, reloadStart.id]);
    final lastSnapshot = h.api.syncs.last.characters.single as Map;
    expect((lastSnapshot['snapshot'] as Map)['level'], 23);

    // Quit: immediate heartbeat, then the game writes the file a few seconds later.
    await h.clock.elapse(const Duration(seconds: 120));
    await h.game(const GameStopped());
    expect(h.api.heartbeats, hasLength(3));
    expect(h.api.heartbeats.last.gameRunning, isFalse);
    expect(h.tray_.whereType<tray.GameStopped>(), hasLength(1));

    await h.clock.elapse(const Duration(seconds: 5));
    final logout = _ev('SESSION_END', h.unix, 5);
    davina = davina.copyWith(capturedAt: h.unix, events: [...davina.events, logout]);
    await h.write(_fileA, [davina]);
    expect(h.api.syncs, hasLength(4));
    expect(h.api.sentEventIds.last, logout.id);

    // Nothing more once the game is closed: no heartbeat, no second final sync.
    await h.clock.elapse(const Duration(hours: 1));
    expect(h.api.heartbeats, hasLength(3));
    expect(h.api.syncs, hasLength(4));

    // Each event sent exactly once, every send reported to the tray.
    expect(h.api.sentEventIds.toSet(), hasLength(h.api.sentEventIds.length));
    expect(h.tray_.whereType<tray.SendSucceeded>().where((e) => e.isSync), hasLength(4));
    expect(h.tray_.whereType<tray.SendSucceeded>().last.character, 'Davina Asaria');
  });

  group('no duplicate events', () {
    test('the same file twice sends nothing the second time', () async {
      await h.start();
      final chars = [
        TestCharacter(capturedAt: h.unix, level: 5, events: [_ev('SESSION_START', h.unix, 1)]),
      ];
      await h.write(_fileA, chars);
      await h.clock.elapse(const Duration(minutes: 5));
      await h.write(_fileA, chars);

      expect(h.api.syncs, hasLength(1));
    });

    test('events already sent are left out, even with a newer snapshot', () async {
      await h.start();
      final a = _ev('SESSION_START', h.unix, 1);
      final b = _ev('DEATH', h.unix + 5, 2);
      await h.write(_fileA, [
        TestCharacter(capturedAt: h.unix, level: 5, events: [a]),
      ]);
      await h.clock.elapse(const Duration(minutes: 1));
      await h.write(_fileA, [
        TestCharacter(capturedAt: h.unix, level: 5, events: [a, b]),
      ]);

      expect(h.api.sentEventIds, [a.id, b.id]);
    });

    test('the ids sent survive a restart', () async {
      await h.start();
      final chars = [
        TestCharacter(capturedAt: h.unix, level: 5, events: [_ev('SESSION_START', h.unix, 1)]),
      ];
      await h.write(_fileA, chars);
      await h.engine.dispose();
      await h.queue.dispose();

      await h.start();
      await h.clock.elapse(const Duration(minutes: 1));
      await h.write(_fileA, chars);

      expect(h.api.syncs, hasLength(1));
    });

    test('a failed sync goes to the queue and is not planned again', () async {
      await h.start();
      final a = _ev('SESSION_START', h.unix, 1);
      h.api.syncError = const ServerError(503);
      await h.write(_fileA, [
        TestCharacter(capturedAt: h.unix, level: 5, events: [a]),
      ]);
      expect(h.tray_.whereType<tray.SendFailed>(), hasLength(1));
      expect(h.queue.length, 1);

      // The same file again, still failing: nothing new to plan.
      await h.clock.elapse(const Duration(seconds: 2));
      await h.write(_fileA, [
        TestCharacter(capturedAt: h.unix - 2, level: 5, events: [a]),
      ]);
      await h.clock.elapse(const Duration(seconds: 1));
      expect(h.api.syncs, hasLength(1));

      h.api.syncError = null;
      await h.clock.elapse(const Duration(seconds: 2)); // replay at 5 s
      expect(h.api.deliveredEventIds, [a.id]);
      expect(h.queue.length, 0);
    });
  });

  group('at most one sync every 30 s', () {
    test('changes inside the window are merged into one sync at its end', () async {
      await h.start();
      final t0 = h.unix;
      final e1 = _ev('SESSION_START', t0, 1);
      final e2 = _ev('LEVEL_UP', t0 + 5, 2);
      final e3 = _ev('DEATH', t0 + 10, 3);

      await h.write(_fileA, [
        TestCharacter(capturedAt: t0, level: 5, events: [e1]),
      ]);
      await h.clock.elapse(const Duration(seconds: 5));
      await h.write(_fileA, [
        TestCharacter(capturedAt: t0 + 5, level: 6, events: [e1, e2]),
      ]);
      await h.clock.elapse(const Duration(seconds: 5));
      await h.write(_fileA, [
        TestCharacter(capturedAt: t0 + 10, level: 6, events: [e1, e2, e3]),
      ]);
      expect(h.api.syncs, hasLength(1));

      await h.clock.elapse(const Duration(seconds: 19));
      expect(h.api.syncs, hasLength(1));

      await h.clock.elapse(const Duration(seconds: 1));
      expect(h.api.syncs, hasLength(2));
      expect(h.api.sentEventIds, [e1.id, e2.id, e3.id]);
      expect(h.api.syncTimes[1].difference(h.api.syncTimes[0]), const Duration(seconds: 30));
    });

    test('two accounts changing together are sent 30 s apart', () async {
      await h.start();
      h.files[_fileB] = savedVariablesLua([
        TestCharacter(guid: 'Player-4242-0B2C3D4E', firstName: 'Morwen', capturedAt: 1, level: 3),
      ]);
      await h.write(_fileA, [TestCharacter(capturedAt: 1, level: 3)]);
      h.fileEvents.add(const FileReady(_fileB));
      await h.clock.elapse(const Duration(minutes: 2));

      expect(h.api.syncs, hasLength(2));
      expect(h.api.syncTimes[1].difference(h.api.syncTimes[0]), const Duration(seconds: 30));
    });

    test('"Synchroniser maintenant" re-reads and sends everything again, after the 30 s', () async {
      await h.start();
      final e1 = _ev('SESSION_START', h.unix, 1);
      await h.write(_fileA, [
        TestCharacter(capturedAt: h.unix, level: 5, events: [e1]),
      ]);
      await h.clock.elapse(const Duration(seconds: 10));

      await h.engine.syncNow();
      await settle();
      expect(h.api.syncs, hasLength(1));

      await h.clock.elapse(const Duration(seconds: 20));
      expect(h.api.syncs, hasLength(2));
      expect(h.api.sentEventIds, [e1.id, e1.id]);
    });
  });

  group('final sync after the game stops', () {
    test('without a rewrite, re-reads the files after 60 s', () async {
      await h.start();
      await h.write(_fileA, [TestCharacter(capturedAt: h.unix, level: 5)]);
      await h.game(const GameStarted());
      await h.clock.elapse(const Duration(minutes: 10));
      await h.game(const GameStopped());

      // Written, but the watcher missed it.
      final logout = _ev('SESSION_END', h.unix, 9);
      h.files[_fileA] = savedVariablesLua([
        TestCharacter(capturedAt: h.unix, level: 5, events: [logout]),
      ]);

      await h.clock.elapse(const Duration(seconds: 59));
      expect(h.api.syncs, hasLength(1));
      await h.clock.elapse(const Duration(seconds: 1));
      expect(h.api.syncs, hasLength(2));
      expect(h.api.sentEventIds, [logout.id]);
    });

    test('sends nothing when the file holds nothing new', () async {
      await h.start();
      await h.write(_fileA, [TestCharacter(capturedAt: h.unix, level: 5)]);
      await h.game(const GameStarted());
      await h.game(const GameStopped());
      await h.clock.elapse(const Duration(minutes: 2));

      expect(h.api.syncs, hasLength(1));
    });
  });

  group('heartbeats', () {
    test('follow the interval returned by the server', () async {
      h.api.intervalSec = 120;
      await h.start();
      await h.game(const GameStarted());
      await h.clock.elapse(const Duration(seconds: 119));
      expect(h.api.heartbeats, hasLength(1));
      await h.clock.elapse(const Duration(seconds: 1));
      expect(h.api.heartbeats, hasLength(2));
    });

    test('carry the character of the most recent SESSION_START', () async {
      await h.start();
      await h.write(_fileA, [
        TestCharacter(capturedAt: 10, level: 5, events: [_ev('SESSION_START', 100, 1)]),
        TestCharacter(
          guid: 'Player-4242-0B2C3D4E',
          firstName: 'Morwen',
          capturedAt: 10,
          level: 3,
          events: const [TestEvent('Player-4242-0B2C3D4E-200-1', 'SESSION_START', 200)],
        ),
      ]);
      await h.game(const GameStarted());

      expect(h.api.heartbeats.single.lastCharacter?.firstName, 'Morwen');
    });

    test('a 401 stops every send and notifies once', () async {
      h.api.heartbeatError = const InvalidToken();
      await h.start();
      await h.game(const GameStarted());

      expect(h.tray_.whereType<tray.Unauthorized>(), hasLength(1));
      expect(h.notifier.shown, hasLength(1));

      await h.write(_fileA, [TestCharacter(capturedAt: h.unix, level: 5)]);
      await h.clock.elapse(const Duration(hours: 1));
      expect(h.api.heartbeats, hasLength(1));
      expect(h.api.syncs, isEmpty);
      expect(h.notifier.shown, hasLength(1));
    });

    test('use the interval of a replayed response', () async {
      await h.start();
      h.api.down = true;
      await h.game(const GameStarted());
      h.api.down = false;
      h.api.intervalSec = 120;
      await h.clock.elapse(const Duration(seconds: 5)); // replayed heartbeat
      expect(h.api.delivered, hasLength(1));

      // The timer set before the replay still fires at 600 s; the next ones use 120 s.
      await h.clock.elapse(const Duration(seconds: 595));
      expect(h.api.delivered, hasLength(2));
      await h.clock.elapse(const Duration(seconds: 119));
      expect(h.api.delivered, hasLength(2));
      await h.clock.elapse(const Duration(seconds: 1));
      expect(h.api.delivered, hasLength(3));
    });
  });

  group('network cut then back', () {
    test('every event reaches the server once, in order, with the game running', () async {
      await h.start();
      final t0 = h.unix;
      final login = _ev('SESSION_START', t0, 1);
      var davina = TestCharacter(capturedAt: t0, level: 22, events: [login]);
      await h.game(const GameStarted());
      await h.write(_fileA, [davina]);
      expect(h.api.deliveredEventIds, [login.id]);

      // The box loses the network; the player levels up twice and logs out.
      h.api.down = true;
      final events = [login];
      for (var i = 2; i <= 4; i++) {
        await h.clock.elapse(const Duration(minutes: 4));
        events.add(_ev('LEVEL_UP', h.unix, i));
        davina = davina.copyWith(capturedAt: h.unix, level: 21 + i, events: [...events]);
        await h.write(_fileA, [davina]);
      }
      await h.clock.elapse(const Duration(minutes: 1));
      await h.game(const GameStopped());
      events.add(_ev('SESSION_END', h.unix, 5));
      davina = davina.copyWith(capturedAt: h.unix, events: [...events]);
      await h.write(_fileA, [davina]);
      expect(h.api.deliveredEventIds, [login.id]);
      expect(h.trayState.color, tray.TrayColor.orange);
      expect(h.trayState.issue, tray.TrayIssue.serverUnreachable);

      // Back online: the queue drains at its next retry.
      h.api.down = false;
      await h.clock.elapse(const Duration(minutes: 10));

      expect(h.queue.length, 0);
      expect(h.api.deliveredEventIds, [for (final e in events) e.id]);
      expect(h.api.deliveredEventIds.toSet(), hasLength(h.api.deliveredEventIds.length));
      final heartbeats = h.api.delivered.where((d) => d.kind == 'heartbeat').toList();
      expect(h.api.heartbeats.last.gameRunning, isFalse);
      expect(heartbeats.length, greaterThanOrEqualTo(2));
      // The order of the sends is kept: each sync's snapshot is newer than the one before.
      final levels = [
        for (final s in h.api.deliveredSyncs)
          ((s.characters.single as Map)['snapshot'] as Map)['level'],
      ];
      expect(levels, [22, 23, 24, 25, 25]);
      expect(h.tray_.last, isA<tray.SendSucceeded>());
      expect(h.trayState.issue, isNull);
    });
  });

  test('unknown schema: nothing sent, orange icon', () async {
    await h.start();
    await h.write(_fileA, [TestCharacter(capturedAt: 1, level: 5)], schema: 2);

    expect(h.api.syncs, isEmpty);
    expect(h.tray_.whereType<tray.UnknownSchema>(), hasLength(1));
  });

  test('not paired: nothing sent', () async {
    h.tokens.token = null;
    await h.start();
    await h.write(_fileA, [TestCharacter(capturedAt: 1, level: 5)]);
    await h.game(const GameStarted());

    expect(h.api.syncs, isEmpty);
    expect(h.api.heartbeats, isEmpty);
  });

  test('a file that is not a pure literal is not sent', () async {
    await h.start();
    h.files[_fileA] = 'ForeverTrackerDB = os.execute("calc")';
    h.fileEvents.add(const FileReady(_fileA));
    await settle();

    expect(h.api.syncs, isEmpty);
  });
}
