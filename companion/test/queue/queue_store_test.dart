import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/api_models.dart';
import 'package:forevertracker_sync/queue/queue_store.dart';
import 'package:forevertracker_sync/queue/queued_request.dart';

import '../support/contract.dart';

QueuedRequest _req(int seq, {QueuedKind kind = QueuedKind.heartbeat}) => QueuedRequest(
  seq: seq,
  kind: kind,
  createdAt: DateTime.utc(2026, 11, 6, 20, 0, seq),
  body: kind == QueuedKind.heartbeat
      ? contractFixture('heartbeat.running.json')
      : contractFixture('sync.valid.json'),
);

void main() {
  late Directory dir;
  late FileQueueStore store;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('ftr-queue-store-');
    store = FileQueueStore(Directory('${dir.path}${Platform.pathSeparator}queue'));
  });
  tearDown(() => dir.delete(recursive: true));

  test('one JSON file per request, loaded back in send order', () async {
    await store.add(_req(10));
    await store.add(_req(2, kind: QueuedKind.sync));
    await store.add(_req(9));

    final files = store.dir.listSync().whereType<File>().toList();
    expect(files, hasLength(3));
    for (final f in files) {
      expect(f.path, endsWith('.json'));
      expect(jsonDecode(f.readAsStringSync()), isA<Map<String, Object?>>());
    }

    final loaded = await store.load();
    expect(loaded.map((r) => r.seq), [2, 9, 10]);
    expect(loaded.first.kind, QueuedKind.sync);
    expect(loaded.first.createdAt, DateTime.utc(2026, 11, 6, 20, 0, 2));
    expect(loaded.first.body, contractFixture('sync.valid.json'));
  });

  test('remove deletes the file', () async {
    await store.add(_req(1));
    await store.add(_req(2));
    await store.remove(1);
    await store.remove(42); // already gone: no error

    expect((await store.load()).map((r) => r.seq), [2]);
  });

  test('a missing folder is an empty queue', () async {
    expect(await store.load(), isEmpty);
  });

  test('unreadable files are deleted, unrelated files are left alone', () async {
    await store.add(_req(1));
    await store.dir.create(recursive: true);
    final sep = Platform.pathSeparator;
    File('${store.dir.path}${sep}0000000002.json').writeAsStringSync('{not json');
    File('${store.dir.path}${sep}0000000003.json').writeAsStringSync('{"seq": 3}');
    File('${store.dir.path}${sep}notes.txt').writeAsStringSync('hello');

    expect((await store.load()).map((r) => r.seq), [1]);
    final names = store.dir.listSync().map((e) => e.uri.pathSegments.last).toSet();
    expect(names, {'0000000001.json', 'notes.txt'});
  });

  test('the bodies rebuild the contract requests', () {
    final hb = HeartbeatRequest.fromJson(contractFixture('heartbeat.running.json'));
    expect(hb.toJson(), contractFixture('heartbeat.running.json'));
    final stopped = HeartbeatRequest.fromJson(contractFixture('heartbeat.stopped.json'));
    expect(stopped.gameRunning, isFalse);
    final sync = SyncRequest.fromJson(contractFixture('sync.valid.json'));
    expect(jsonDecode(jsonEncode(sync.toJson())), contractFixture('sync.valid.json'));
    expect(() => HeartbeatRequest.fromJson({'sentAt': 'x'}), throwsA(isA<FormatException>()));
  });
}
