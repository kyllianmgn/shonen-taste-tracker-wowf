import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/wow_files/saved_variables_watcher.dart';

import 'wow_tree.dart';

// Real folders and real timers, with short delays so the suite stays fast.
const stableFor = Duration(milliseconds: 400);
const checkEvery = Duration(milliseconds: 50);
const pollEvery = Duration(milliseconds: 300);

/// Long enough for detection (poll or system event) plus the stability wait.
const settle = Duration(milliseconds: 1500);

void main() {
  late WowTree tree;
  late List<FileReady> events;
  late List<DateTime> eventTimes;
  late StreamSubscription<FileReady> sub;
  SavedVariablesWatcher? watcher;

  setUp(() {
    tree = WowTree.create();
    tree.createWtf();
    events = [];
    eventTimes = [];
  });

  tearDown(() async {
    await sub.cancel();
    await watcher?.dispose();
    watcher = null;
    tree.delete();
  });

  Future<SavedVariablesWatcher> startWatcher({bool useSystemWatcher = true}) async {
    final w = SavedVariablesWatcher(
      tree.forever,
      pollInterval: pollEvery,
      stableFor: stableFor,
      stabilityCheckInterval: checkEvery,
      useSystemWatcher: useSystemWatcher,
    );
    sub = w.events.listen((e) {
      events.add(e);
      eventTimes.add(DateTime.now());
    });
    await w.start();
    watcher = w;
    return w;
  }

  List<String> paths() => events.map((e) => e.path).toList();

  for (final useSystemWatcher in [true, false]) {
    final mode = useSystemWatcher ? 'system watcher + polling' : 'polling only';

    group(mode, () {
      test('emits FileReady once for each account file present at start', () async {
        tree.writeFile(tree.savedVariables('A'), 'a');
        tree.writeFile(tree.savedVariables('B'), 'b');
        tree.writeFile(tree.savedVariables('B', file: 'OtherAddon.lua'), 'o');

        await startWatcher(useSystemWatcher: useSystemWatcher);
        await Future<void>.delayed(settle);

        expect(paths()..sort(), [tree.savedVariables('A'), tree.savedVariables('B')]);
      });

      test('a file written in several parts is emitted once, after it stays stable', () async {
        await startWatcher(useSystemWatcher: useSystemWatcher);
        final file = File(tree.savedVariables('A'));
        file.parent.createSync(recursive: true);

        final sink = file.openSync(mode: FileMode.write);
        for (var i = 0; i < 4; i++) {
          sink.writeStringSync('ForeverTrackerDB = { part = $i }\n');
          sink.flushSync();
          await Future<void>.delayed(const Duration(milliseconds: 150));
        }
        sink.closeSync();
        final lastWrite = DateTime.now();

        await Future<void>.delayed(settle);

        expect(paths(), [file.path]);
        expect(
          eventTimes.single.difference(lastWrite),
          greaterThanOrEqualTo(stableFor - const Duration(milliseconds: 20)),
        );
      });

      test('does not emit again while the file is unchanged', () async {
        tree.writeFile(tree.savedVariables('A'), 'a');
        await startWatcher(useSystemWatcher: useSystemWatcher);
        await Future<void>.delayed(settle);
        expect(events, hasLength(1));

        await Future<void>.delayed(pollEvery * 4);
        expect(events, hasLength(1));
      });

      test('emits again when the file changes', () async {
        final file = tree.writeFile(tree.savedVariables('A'), 'a');
        await startWatcher(useSystemWatcher: useSystemWatcher);
        await Future<void>.delayed(settle);

        file.writeAsStringSync('a longer content', flush: true);
        await Future<void>.delayed(settle);

        expect(paths(), [file.path, file.path]);
      });

      test('a deleted then recreated file is emitted again, never while missing', () async {
        final file = tree.writeFile(tree.savedVariables('A'), 'first');
        await startWatcher(useSystemWatcher: useSystemWatcher);
        await Future<void>.delayed(settle);
        expect(events, hasLength(1));

        file.deleteSync();
        await Future<void>.delayed(settle);
        expect(events, hasLength(1));

        // Same content as before: the new file must still be reported.
        tree.writeFile(file.path, 'first');
        await Future<void>.delayed(settle);
        expect(paths(), [file.path, file.path]);
      });

      test('a file deleted before it becomes stable is not emitted', () async {
        await startWatcher(useSystemWatcher: useSystemWatcher);
        final file = tree.writeFile(tree.savedVariables('A'), 'half');
        await Future<void>.delayed(checkEvery * 2);
        file.deleteSync();

        await Future<void>.delayed(settle);
        expect(events, isEmpty);
      });

      test('picks up an account created after start', () async {
        tree.writeFile(tree.savedVariables('A'), 'a');
        await startWatcher(useSystemWatcher: useSystemWatcher);
        await Future<void>.delayed(settle);

        tree.writeFile(tree.savedVariables('NEW'), 'n');
        await Future<void>.delayed(settle);

        expect(paths(), [tree.savedVariables('A'), tree.savedVariables('NEW')]);
      });

      test('ignores other files under WTF', () async {
        await startWatcher(useSystemWatcher: useSystemWatcher);
        tree.writeFile(WowTree.p(tree.wtf, 'Config.wtf'), 'SET x "1"');
        tree.writeFile(tree.savedVariables('A', file: 'OtherAddon.lua'), 'o');
        tree.writeFile(tree.savedVariables('A', file: 'ForeverTracker.lua.bak'), 'b');

        await Future<void>.delayed(settle);
        expect(events, isEmpty);
      });
    });
  }

  test('the system watcher reports a change well before the next poll', () async {
    final w = SavedVariablesWatcher(
      tree.forever,
      pollInterval: const Duration(minutes: 1),
      stableFor: stableFor,
      stabilityCheckInterval: checkEvery,
    );
    sub = w.events.listen(events.add);
    watcher = w;
    await w.start();

    tree.writeFile(tree.savedVariables('A'), 'a');
    await Future<void>.delayed(settle);

    expect(paths(), [tree.savedVariables('A')]);
  });

  test('stop cancels pending checks and dispose closes the stream', () async {
    final w = await startWatcher();
    tree.writeFile(tree.savedVariables('A'), 'a');
    await Future<void>.delayed(checkEvery);
    await w.stop();
    await Future<void>.delayed(settle);
    expect(events, isEmpty);

    final done = Completer<void>();
    w.events.listen(null, onDone: done.complete);
    await w.dispose();
    await done.future.timeout(const Duration(seconds: 1));
  });

  test('uses the spec delays by default', () {
    final w = SavedVariablesWatcher(tree.forever);
    expect(w.pollInterval, const Duration(seconds: 10));
    expect(w.stableFor, const Duration(seconds: 2));
    sub = const Stream<FileReady>.empty().listen(null);
  });
}
