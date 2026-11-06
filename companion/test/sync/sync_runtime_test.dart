import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/sync/sync_runtime.dart';

class FakeSession implements SyncSession {
  FakeSession(this.folder, this.log);

  final String folder;
  final List<String> log;

  @override
  Future<void> start() async => log.add('start $folder');

  @override
  Future<void> stop() async => log.add('stop $folder');

  @override
  Future<void> syncNow() async => log.add('sync $folder');
}

void main() {
  late List<String> log;
  late SyncRuntime runtime;

  setUp(() {
    log = [];
    runtime = SyncRuntime((folder) => FakeSession(folder, log));
  });

  test('starts a session once the game folder is known', () async {
    await runtime.syncNow();
    await runtime.setGameFolder(null);
    await runtime.setGameFolder(r'C:\WoW\_forever_');
    await runtime.syncNow();

    expect(log, [r'start C:\WoW\_forever_', r'sync C:\WoW\_forever_']);
  });

  test('keeps the session when the folder is the same, case aside', () async {
    await runtime.setGameFolder(r'C:\WoW\_forever_');
    await runtime.setGameFolder(r'c:\wow\_FOREVER_');

    expect(log, [r'start C:\WoW\_forever_']);
  });

  test('replaces the session when the folder changes, and stops it on dispose', () async {
    await runtime.setGameFolder(r'C:\A\_forever_');
    await runtime.setGameFolder(r'D:\B\_forever_');
    await runtime.dispose();

    expect(log, [
      r'start C:\A\_forever_',
      r'stop C:\A\_forever_',
      r'start D:\B\_forever_',
      r'stop D:\B\_forever_',
    ]);
  });

  test('a sync asked during a folder change waits for the new session', () async {
    final change = runtime.setGameFolder(r'C:\WoW\_forever_');
    final sync = runtime.syncNow();
    await Future.wait([change, sync]);

    expect(log, [r'start C:\WoW\_forever_', r'sync C:\WoW\_forever_']);
  });
}
