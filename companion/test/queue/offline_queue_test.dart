import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/api_error.dart';
import 'package:forevertracker_sync/api/api_models.dart';
import 'package:forevertracker_sync/api/device_token.dart';
import 'package:forevertracker_sync/queue/offline_queue.dart';
import 'package:forevertracker_sync/queue/queue_store.dart';
import 'package:forevertracker_sync/ui/tray/tray_state.dart' as tray;

import '../support/contract.dart';
import '../support/fake_clock.dart';
import '../support/fake_companion_api.dart';
import '../support/memory_queue_store.dart';
import '../support/memory_token_store.dart';

class Harness {
  Harness({QueueStore? store}) : store = store ?? MemoryQueueStore() {
    api = FakeCompanionApi(clock);
  }

  final clock = FakeClock();
  late final FakeCompanionApi api;
  final tokens = MemoryTokenStore()..token = const DeviceToken('tok');
  final QueueStore store;
  final notifier = RecordingNotifier();
  final tray_ = <tray.TrayEvent>[];
  late OfflineQueue queue;

  int get unix => clock.now().millisecondsSinceEpoch ~/ 1000;

  Future<void> start() async {
    queue = OfflineQueue(
      api: api,
      tokens: tokens,
      store: store,
      emit: tray_.add,
      notifier: notifier,
      now: clock.now,
      timer: clock.timer,
    );
    await queue.start();
    await settle();
  }

  HeartbeatRequest heartbeat({bool running = true}) =>
      HeartbeatRequest(sentAt: unix, gameRunning: running, appVersion: '1.0.0');

  /// `sync.valid.json` with its own `sentAt`, so each sync can be told apart.
  SyncRequest sync() {
    final fixture = SyncRequest.fromJson(contractFixture('sync.valid.json'));
    return SyncRequest(
      sentAt: unix,
      schema: fixture.schema,
      addonVersion: fixture.addonVersion,
      characters: fixture.characters,
    );
  }

  List<Duration> get attemptOffsets {
    final first = api.attemptTimes.first;
    return [for (final t in api.attemptTimes) t.difference(first)];
  }
}

void main() {
  late Harness h;

  setUp(() => h = Harness());
  tearDown(() => h.queue.dispose());

  test('online: sent right away, nothing queued', () async {
    await h.start();
    final outcome = await h.queue.sync(h.sync());

    expect(outcome, isA<Delivered<SyncResponse>>());
    expect(h.api.delivered, hasLength(1));
    expect(h.queue.length, 0);
  });

  group('network cut then back', () {
    test(
      'a failed request is queued and replayed after 5 s, 30 s, 2 min, then every 10 min',
      () async {
        await h.start();
        h.api.down = true;
        final outcome = await h.queue.heartbeat(h.heartbeat());
        expect(outcome, isA<Queued<HeartbeatResponse>>());
        expect(h.queue.length, 1);
        expect(h.tray_.whereType<tray.SendFailed>(), hasLength(1));

        await h.clock.elapse(const Duration(minutes: 25));
        expect(h.attemptOffsets, const [
          Duration.zero,
          Duration(seconds: 5),
          Duration(seconds: 35),
          Duration(seconds: 155),
          Duration(seconds: 755),
          Duration(seconds: 1355),
        ]);
      },
    );

    test('everything queued goes out in the order it was sent, once the network is back', () async {
      await h.start();
      h.api.down = true;
      final first = h.heartbeat();
      await h.queue.heartbeat(first);
      await h.clock.elapse(const Duration(seconds: 20));
      final sync1 = h.sync();
      expect(await h.queue.sync(sync1), isA<Queued<SyncResponse>>());
      await h.clock.elapse(const Duration(seconds: 20));
      final stopped = h.heartbeat(running: false);
      await h.queue.heartbeat(stopped);
      await h.clock.elapse(const Duration(seconds: 20));
      final sync2 = h.sync();
      await h.queue.sync(sync2);
      expect(h.queue.length, 4);
      expect(h.api.delivered, isEmpty);

      h.api.down = false;
      await h.clock.elapse(const Duration(minutes: 3));

      expect(h.api.delivered.map((d) => (d.kind, d.sentAt)), [
        ('heartbeat', first.sentAt),
        ('sync', sync1.sentAt),
        ('heartbeat', stopped.sentAt),
        ('sync', sync2.sentAt),
      ]);
      expect(h.queue.length, 0);
      expect(h.tray_.last, isA<tray.SendSucceeded>());
      expect((h.tray_.last as tray.SendSucceeded).isSync, isTrue);
    });

    test('a request made while the queue is not empty waits its turn, even online', () async {
      await h.start();
      h.api.down = true;
      await h.queue.sync(h.sync());
      h.api.down = false;

      final later = h.heartbeat();
      expect(await h.queue.heartbeat(later), isA<Queued<HeartbeatResponse>>());
      expect(h.api.delivered, isEmpty);

      await h.clock.elapse(const Duration(seconds: 5));
      expect(h.api.delivered.map((d) => d.kind), ['sync', 'heartbeat']);
    });

    test('the delays start over after a success', () async {
      await h.start();
      h.api.down = true;
      await h.queue.sync(h.sync());
      await h.clock.elapse(const Duration(minutes: 3)); // 5 s, 30 s, 2 min failed
      h.api.down = false;
      await h.clock.elapse(const Duration(minutes: 10));
      expect(h.queue.length, 0);

      h.api.down = true;
      final before = h.api.attemptTimes.length;
      await h.queue.sync(h.sync());
      await h.clock.elapse(const Duration(seconds: 5));
      expect(h.api.attemptTimes.length, before + 2);
    });

    test('a 5xx and a 429 are queued; Retry-After is honoured when longer', () async {
      await h.start();
      h.api.syncError = const ServerError(503);
      expect(await h.queue.sync(h.sync()), isA<Queued<SyncResponse>>());

      h.api.syncError = const RateLimited(Duration(seconds: 50));
      await h.clock.elapse(const Duration(seconds: 5)); // 429, wait 50 s instead of 30 s
      h.api.syncError = null;
      await h.clock.elapse(const Duration(seconds: 49));
      expect(h.api.delivered, isEmpty);
      await h.clock.elapse(const Duration(seconds: 1));
      expect(h.api.delivered, hasLength(1));
    });

    test('a request the server refuses for good is dropped, the next ones still go', () async {
      await h.start();
      h.api.down = true;
      await h.queue.sync(h.sync());
      await h.queue.heartbeat(h.heartbeat());
      h.api.down = false;
      h.api.syncError = const PayloadTooLarge();

      await h.clock.elapse(const Duration(seconds: 5));
      expect(h.api.delivered.map((d) => d.kind), ['heartbeat']);
      expect(h.queue.length, 0);
    });

    test('"Synchroniser maintenant" retries the queue without waiting', () async {
      await h.start();
      h.api.down = true;
      await h.queue.sync(h.sync());
      await h.clock.elapse(const Duration(minutes: 3));
      h.api.down = false;

      await h.queue.retryNow();
      await settle();
      expect(h.api.delivered, hasLength(1));
    });

    test('an error with no response (not retryable) is not queued', () async {
      await h.start();
      h.api.syncError = const ValidationFailed();
      expect(await h.queue.sync(h.sync()), isA<NotSent<SyncResponse>>());
      expect(h.queue.length, 0);
    });

    test('a 422 on replay turns the icon orange "mets à jour l\'appli"', () async {
      await h.start();
      h.api.down = true;
      await h.queue.sync(h.sync());
      h.api.down = false;
      h.api.syncError = const SchemaRejected();
      await h.clock.elapse(const Duration(seconds: 5));

      expect(h.tray_.whereType<tray.UnknownSchema>(), hasLength(1));
      expect(h.queue.length, 0);
    });
  });

  group('expiry', () {
    test('heartbeats older than 30 min are dropped, syncs are kept', () async {
      await h.start();
      h.api.down = true;
      await h.queue.heartbeat(h.heartbeat());
      await h.queue.sync(h.sync());
      await h.clock.elapse(const Duration(minutes: 31));
      final recent = h.heartbeat();
      await h.queue.heartbeat(recent);

      h.api.down = false;
      await h.clock.elapse(const Duration(minutes: 10));

      expect(h.api.delivered.map((d) => (d.kind, d.sentAt)), [
        ('sync', h.api.syncs.first.sentAt),
        ('heartbeat', recent.sentAt),
      ]);
    });

    test('a heartbeat 30 min old exactly is still sent', () async {
      await h.start();
      h.api.down = true;
      await h.queue.heartbeat(h.heartbeat());
      // Attempts at 5 s, 35 s, 155 s, 755 s, 1355 s, then 1955 s: stop just before 30 min.
      await h.clock.elapse(const Duration(seconds: 1355));
      h.api.down = false;
      await h.clock.elapse(const Duration(seconds: 445)); // 30 min after the first attempt
      await h.queue.retryNow();
      await settle();

      expect(h.api.delivered, hasLength(1));
    });

    test('syncs are kept 7 days, then dropped', () async {
      await h.start();
      h.api.down = true;
      await h.queue.sync(h.sync());
      await h.clock.elapse(const Duration(days: 6, hours: 23));
      final kept = h.sync();
      await h.queue.sync(kept);
      await h.clock.elapse(const Duration(hours: 2)); // the first is now 7 days 1 h old

      h.api.down = false;
      await h.clock.elapse(const Duration(minutes: 10));
      expect(h.api.delivered.map((d) => d.sentAt), [kept.sentAt]);
    });
  });

  group('401', () {
    test('stops every send, orange icon, one Windows notification', () async {
      await h.start();
      h.api.heartbeatError = const InvalidToken();
      expect(await h.queue.heartbeat(h.heartbeat()), isA<NotSent<HeartbeatResponse>>());

      expect(h.tray_.whereType<tray.Unauthorized>(), hasLength(1));
      expect(h.notifier.shown, hasLength(1));
      expect(h.notifier.shown.single.body, contains("réappaire l'appli avec /lier appli"));

      final attempts = h.api.attemptTimes.length;
      expect(await h.queue.sync(h.sync()), isA<NotSent<SyncResponse>>());
      expect(await h.queue.heartbeat(h.heartbeat()), isA<NotSent<HeartbeatResponse>>());
      await h.clock.elapse(const Duration(hours: 1));
      expect(h.api.attemptTimes, hasLength(attempts));
      expect(h.notifier.shown, hasLength(1));
      expect(h.tray_.whereType<tray.Unauthorized>(), hasLength(1));
    });

    test('during a replay: the queue stays on disk and goes out after a new pairing', () async {
      await h.start();
      h.api.down = true;
      final sync = h.sync();
      await h.queue.sync(sync);
      h.api.down = false;
      h.api.syncError = const InvalidToken();
      await h.clock.elapse(const Duration(seconds: 5));

      expect(h.tray_.whereType<tray.Unauthorized>(), hasLength(1));
      expect(h.notifier.shown, hasLength(1));
      expect(h.queue.length, 1);
      await h.clock.elapse(const Duration(hours: 1));
      expect(h.api.attemptTimes, hasLength(2));

      h.api.syncError = null;
      h.tokens.token = const DeviceToken('new');
      await h.queue.resume();
      await settle();
      expect(h.api.delivered.map((d) => d.sentAt), [sync.sentAt]);
      expect(h.queue.length, 0);
    });

    test('unpairing empties the queue', () async {
      await h.start();
      h.api.down = true;
      await h.queue.sync(h.sync());
      await h.queue.clear();
      h.api.down = false;
      await h.clock.elapse(const Duration(minutes: 30));

      expect(h.queue.length, 0);
      expect(h.api.delivered, isEmpty);
      expect((h.store as MemoryQueueStore).files, isEmpty);
    });
  });

  test('not paired: nothing sent, nothing queued', () async {
    h.tokens.token = null;
    await h.start();
    expect(await h.queue.sync(h.sync()), isA<NotSent<SyncResponse>>());
    expect(h.api.attemptTimes, isEmpty);
    expect(h.queue.length, 0);
  });

  test('the interval of a replayed response is published', () async {
    await h.start();
    final intervals = <int>[];
    h.queue.heartbeatIntervals.listen(intervals.add);
    h.api.down = true;
    await h.queue.heartbeat(h.heartbeat());
    h.api.down = false;
    h.api.intervalSec = 300;
    await h.clock.elapse(const Duration(seconds: 5));

    expect(intervals, [300]);
  });

  group('app restart with a non-empty queue', () {
    late Directory dir;

    setUp(() async {
      dir = await Directory.systemTemp.createTemp('ftr-queue-');
    });
    tearDown(() async {
      if (await dir.exists()) await dir.delete(recursive: true);
    });

    test('the files left on disk are sent in order on the next start', () async {
      h = Harness(store: FileQueueStore(dir));
      await h.start();
      h.api.down = true;
      final hb = h.heartbeat();
      await h.queue.heartbeat(hb);
      final s1 = h.sync();
      await h.queue.sync(s1);
      await h.clock.elapse(const Duration(seconds: 1));
      final s2 = h.sync();
      await h.queue.sync(s2);
      await h.queue.dispose();
      expect(dir.listSync().whereType<File>(), hasLength(3));

      // Same files, new process, one second later.
      final next = Harness(store: FileQueueStore(dir));
      h = next;
      await next.clock.elapse(const Duration(seconds: 1));
      await next.start();

      expect(next.api.delivered.map((d) => (d.kind, d.sentAt)), [
        ('heartbeat', hb.sentAt),
        ('sync', s1.sentAt),
        ('sync', s2.sentAt),
      ]);
      expect(dir.listSync().whereType<File>(), isEmpty);
    });

    test('expired requests found on disk are dropped at start', () async {
      h = Harness(store: FileQueueStore(dir));
      await h.start();
      h.api.down = true;
      await h.queue.heartbeat(h.heartbeat());
      final s = h.sync();
      await h.queue.sync(s);
      await h.queue.dispose();

      final next = Harness(store: FileQueueStore(dir));
      h = next;
      await next.clock.elapse(const Duration(hours: 2));
      await next.start();

      expect(next.api.delivered.map((d) => d.kind), ['sync']);
      expect(next.api.heartbeats, isEmpty);
    });

    test('new requests after a restart go behind the old ones', () async {
      h = Harness(store: FileQueueStore(dir));
      await h.start();
      h.api.down = true;
      final old = h.sync();
      await h.queue.sync(old);
      await h.queue.dispose();

      final next = Harness(store: FileQueueStore(dir));
      h = next;
      next.api.down = true;
      await next.clock.elapse(const Duration(seconds: 10));
      await next.start();
      final fresh = next.sync();
      await next.queue.sync(fresh);
      next.api.down = false;
      await next.clock.elapse(const Duration(seconds: 5));

      expect(next.api.delivered.map((d) => d.sentAt), [old.sentAt, fresh.sentAt]);
    });
  });
}
