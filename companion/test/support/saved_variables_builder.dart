/// Builds ForeverTracker.lua sources for sync tests.
library;

class TestEvent {
  const TestEvent(this.id, this.type, this.at, [this.data = const {}]);

  final String id;
  final String type;
  final int at;
  final Map<String, Object> data;
}

class TestCharacter {
  const TestCharacter({
    this.guid = 'Player-4242-0A1B2C3D',
    this.firstName = 'Davina',
    this.surname = 'Asaria',
    required this.capturedAt,
    required this.level,
    this.events = const [],
  });

  final String guid;
  final String firstName;
  final String surname;
  final int capturedAt;
  final int level;
  final List<TestEvent> events;

  TestCharacter copyWith({int? capturedAt, int? level, List<TestEvent>? events}) => TestCharacter(
    guid: guid,
    firstName: firstName,
    surname: surname,
    capturedAt: capturedAt ?? this.capturedAt,
    level: level ?? this.level,
    events: events ?? this.events,
  );
}

String _lua(Object value) => switch (value) {
  String s => '"${s.replaceAll(r'\', r'\\').replaceAll('"', r'\"')}"',
  bool b => '$b',
  num n => '$n',
  Map<String, Object> m =>
    '{ ${[for (final e in m.entries) '["${e.key}"] = ${_lua(e.value)}'].join(', ')} }',
  List<Object> l => '{ ${l.map(_lua).join(', ')} }',
  _ => throw ArgumentError('unsupported $value'),
};

String savedVariablesLua(
  List<TestCharacter> characters, {
  Object schema = 1,
  String addonVersion = '0.1.0',
}) {
  final chars = <String, Object>{
    for (final c in characters)
      c.guid: <String, Object>{
        'key': <String, Object>{
          'region': 'eu',
          'firstName': c.firstName,
          'surname': c.surname,
          'guid': c.guid,
          'realmName': 'CAMWOW EU5 Realm 1 PvE',
        },
        'snapshot': <String, Object>{
          'capturedAt': c.capturedAt,
          'level': c.level,
          'zone': 'Duskwood',
          'equipment': <Object>[],
        },
        'events': <Object>[
          for (final e in c.events)
            <String, Object>{'id': e.id, 'type': e.type, 'at': e.at, 'data': e.data},
        ],
      },
  };
  return 'ForeverTrackerDB = ${_lua(<String, Object>{
    'schema': schema,
    'addonVersion': addonVersion,
    'settings': <String, Object>{'interval': 15},
    'characters': chars,
  })}\n';
}
