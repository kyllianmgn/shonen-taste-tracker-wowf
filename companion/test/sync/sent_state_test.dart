import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/sync/sent_state.dart';

Map<String, Object?> _char(String first, int capturedAt, List<String> ids) => {
  'key': {'region': 'eu', 'firstName': first, 'surname': 'Asaria'},
  'snapshot': {'capturedAt': capturedAt, 'level': 10},
  'events': [
    for (final id in ids) {'id': id, 'type': 'DEATH', 'at': 1, 'data': <String, Object?>{}},
  ],
};

void main() {
  group('SentState', () {
    test('remembers the last capturedAt per character and the sent event ids', () {
      final state = SentState()..markSent([_char('Davina', 100, ['a', 'b'])]);

      expect(state.lastCapturedAt(characterKeyOf(_char('Davina', 0, []))!), 100);
      expect(state.lastCapturedAt('eu/Morwen/Asaria'), isNull);
      expect(state.wasSent('a'), isTrue);
      expect(state.wasSent('c'), isFalse);
    });

    test('never moves capturedAt backwards', () {
      final state = SentState()
        ..markSent([_char('Davina', 100, [])])
        ..markSent([_char('Davina', 50, [])]);

      expect(state.lastCapturedAt('eu/Davina/Asaria'), 100);
    });

    test('keeps only the 1 000 most recent ids', () {
      final state = SentState()
        ..markSent([
          _char('Davina', 1, [for (var i = 0; i < 1005; i++) 'id-$i']),
        ]);

      expect(state.eventIdCount, 1000);
      expect(state.wasSent('id-4'), isFalse);
      expect(state.wasSent('id-5'), isTrue);
      expect(state.wasSent('id-1004'), isTrue);
    });

    test('an id sent again becomes the most recent', () {
      final state = SentState(maxEventIds: 3)
        ..markSent([
          _char('Davina', 1, ['a', 'b', 'c']),
        ])
        ..markSent([
          _char('Davina', 1, ['a']),
        ])
        ..markSent([
          _char('Davina', 1, ['d']),
        ]);

      expect(state.wasSent('a'), isTrue);
      expect(state.wasSent('b'), isFalse);
    });

    test('round-trips through JSON', () {
      final state = SentState()..markSent([_char('Davina', 100, ['a', 'b'])]);
      final copy = SentState.fromJson(state.toJson());

      expect(copy.lastCapturedAt('eu/Davina/Asaria'), 100);
      expect(copy.wasSent('b'), isTrue);
    });
  });

  group('FileSentStateStore', () {
    late Directory dir;
    late File file;

    setUp(() {
      dir = Directory.systemTemp.createTempSync('ftr_sent_');
      file = File('${dir.path}${Platform.pathSeparator}sync-state.json');
    });
    tearDown(() => dir.deleteSync(recursive: true));

    test('starts empty when the file is missing', () async {
      final state = await FileSentStateStore(file).load();
      expect(state.eventIdCount, 0);
    });

    test('saves and loads', () async {
      final store = FileSentStateStore(file);
      await store.save(SentState()..markSent([_char('Davina', 7, ['x'])]));

      final loaded = await store.load();
      expect(loaded.lastCapturedAt('eu/Davina/Asaria'), 7);
      expect(loaded.wasSent('x'), isTrue);
    });

    test('starts empty when the file is broken', () async {
      file.writeAsStringSync('{not json');
      final state = await FileSentStateStore(file).load();
      expect(state.eventIdCount, 0);
    });
  });
}
