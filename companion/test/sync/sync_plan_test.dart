import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/api_models.dart';
import 'package:forevertracker_sync/sync/sent_state.dart';
import 'package:forevertracker_sync/sync/sync_plan.dart';

Map<String, Object?> _char(
  String first,
  int capturedAt,
  List<(String id, String type, int at)> events,
) => {
  'key': {'region': 'eu', 'firstName': first, 'surname': 'Asaria', 'guid': 'Player-$first'},
  'snapshot': {'capturedAt': capturedAt, 'level': 10},
  'events': [
    for (final (id, type, at) in events) {'id': id, 'type': type, 'at': at, 'data': {}},
  ],
};

List<String> _ids(Map<String, Object?> character) => [
  for (final e in character['events'] as List) (e as Map)['id'] as String,
];

void main() {
  group('planCharacters', () {
    test('sends everything the first time', () {
      final plan = planCharacters([
        _char('Davina', 100, [('a', 'SESSION_START', 90)]),
      ], SentState());

      expect(plan, hasLength(1));
      expect(_ids(plan.single), ['a']);
      expect((plan.single['snapshot'] as Map)['capturedAt'], 100);
    });

    test('skips a character with an old snapshot and no new event', () {
      final state = SentState()
        ..markSent([
          _char('Davina', 100, [('a', 'SESSION_START', 90)]),
        ]);

      expect(
        planCharacters([
          _char('Davina', 100, [('a', 'SESSION_START', 90)]),
        ], state),
        isEmpty,
      );
    });

    test('sends a newer snapshot without the events already sent', () {
      final state = SentState()
        ..markSent([
          _char('Davina', 100, [('a', 'SESSION_START', 90)]),
        ]);

      final plan = planCharacters([
        _char('Davina', 200, [('a', 'SESSION_START', 90)]),
      ], state);

      expect(plan, hasLength(1));
      expect(_ids(plan.single), isEmpty);
    });

    test('sends only the new events, with the snapshot the contract requires', () {
      final state = SentState()
        ..markSent([
          _char('Davina', 100, [('a', 'SESSION_START', 90)]),
        ]);

      final plan = planCharacters([
        _char('Davina', 100, [('a', 'SESSION_START', 90), ('b', 'LEVEL_UP', 95)]),
        _char('Morwen', 50, []),
      ], state);

      expect(plan.map((c) => (c['key'] as Map)['firstName']), ['Davina', 'Morwen']);
      expect(_ids(plan.first), ['b']);
      expect(plan.first['snapshot'], isNotNull);
    });

    test('force sends everything again', () {
      final state = SentState()
        ..markSent([
          _char('Davina', 100, [('a', 'SESSION_START', 90)]),
        ]);

      final plan = planCharacters(
        [
          _char('Davina', 100, [('a', 'SESSION_START', 90)]),
        ],
        state,
        force: true,
      );

      expect(_ids(plan.single), ['a']);
    });

    test('ignores entries without a usable key', () {
      expect(
        planCharacters([
          'junk',
          {'key': 'x', 'snapshot': {}, 'events': []},
        ], SentState()),
        isEmpty,
      );
    });
  });

  group('lastSessionStart', () {
    test('is the character of the most recent SESSION_START', () {
      final last = lastSessionStart([
        _char('Davina', 100, [('a', 'SESSION_START', 90), ('b', 'LEVEL_UP', 300)]),
        _char('Morwen', 50, [('c', 'SESSION_START', 200), ('d', 'SESSION_END', 250)]),
      ]);

      expect(last?.at, 200);
      expect(
        last?.character,
        const CharacterRef(region: 'eu', firstName: 'Morwen', surname: 'Asaria'),
      );
    });

    test('is null without any SESSION_START', () {
      expect(lastSessionStart([_char('Davina', 1, [])]), isNull);
    });
  });
}
