// Bodies of the exchange contract (docs/02 « Contrat d'échange », contract/schemas).
// Requests only serialize; responses parse strictly and throw [FormatException]
// when a required field is missing or mistyped.

import 'device_token.dart';

class CharacterRef {
  const CharacterRef({required this.region, required this.firstName, required this.surname});

  final String region;
  final String firstName;
  final String surname;

  Map<String, Object?> toJson() => {'region': region, 'firstName': firstName, 'surname': surname};

  factory CharacterRef.fromJson(Object? json) {
    final m = _map(json);
    return CharacterRef(
      region: _field<String>(m, 'region'),
      firstName: _field<String>(m, 'firstName'),
      surname: _field<String>(m, 'surname'),
    );
  }

  @override
  bool operator ==(Object other) =>
      other is CharacterRef &&
      other.region == region &&
      other.firstName == firstName &&
      other.surname == surname;

  @override
  int get hashCode => Object.hash(region, firstName, surname);

  @override
  String toString() => 'CharacterRef($region/$firstName $surname)';
}

/// `pair.request.json`. Holds the pairing code: never log it.
class PairRequest {
  const PairRequest({
    required this.code,
    required this.deviceName,
    required this.appVersion,
    this.os = 'windows',
  });

  final String code;
  final String deviceName;
  final String appVersion;
  final String os;

  Map<String, Object?> toJson() => {
    'code': code,
    'deviceName': deviceName,
    'appVersion': appVersion,
    'os': os,
  };

  @override
  String toString() => 'PairRequest(deviceName: $deviceName, appVersion: $appVersion, os: $os)';
}

/// `pair.response.json`.
class PairResponse {
  const PairResponse({
    required this.deviceId,
    required this.deviceToken,
    required this.heartbeatIntervalSec,
  });

  final String deviceId;
  final DeviceToken deviceToken;
  final int heartbeatIntervalSec;

  factory PairResponse.fromJson(Object? json) {
    final m = _map(json);
    return PairResponse(
      deviceId: _field<String>(m, 'deviceId'),
      deviceToken: DeviceToken(_field<String>(m, 'deviceToken')),
      heartbeatIntervalSec: _field<int>(m, 'heartbeatIntervalSec'),
    );
  }
}

/// `heartbeat.request.json`.
class HeartbeatRequest {
  const HeartbeatRequest({
    required this.sentAt,
    required this.gameRunning,
    required this.appVersion,
    this.lastCharacter,
  });

  /// Unix seconds.
  final int sentAt;
  final bool gameRunning;
  final String appVersion;

  /// Unknown until the addon wrote something.
  final CharacterRef? lastCharacter;

  Map<String, Object?> toJson() => {
    'sentAt': sentAt,
    'gameRunning': gameRunning,
    'appVersion': appVersion,
    if (lastCharacter != null) 'lastCharacter': lastCharacter!.toJson(),
  };

  /// Reads back [toJson], for the offline queue.
  factory HeartbeatRequest.fromJson(Object? json) {
    final m = _map(json);
    final last = m['lastCharacter'];
    return HeartbeatRequest(
      sentAt: _field<int>(m, 'sentAt'),
      gameRunning: _field<bool>(m, 'gameRunning'),
      appVersion: _field<String>(m, 'appVersion'),
      lastCharacter: last == null ? null : CharacterRef.fromJson(last),
    );
  }
}

/// `heartbeat.response.json`.
class HeartbeatResponse {
  const HeartbeatResponse({required this.heartbeatIntervalSec, required this.serverTime});

  final int heartbeatIntervalSec;
  final int serverTime;

  factory HeartbeatResponse.fromJson(Object? json) {
    final m = _map(json);
    return HeartbeatResponse(
      heartbeatIntervalSec: _field<int>(m, 'heartbeatIntervalSec'),
      serverTime: _field<int>(m, 'serverTime'),
    );
  }
}

/// `sync.request.json`. [characters] are the normalized entries of the
/// SavedVariables file (`parseSavedVariables`), sent as is.
class SyncRequest {
  const SyncRequest({
    required this.sentAt,
    required this.schema,
    required this.addonVersion,
    required this.characters,
  });

  final int sentAt;
  final int schema;
  final String addonVersion;
  final List<Object?> characters;

  Map<String, Object?> toJson() => {
    'sentAt': sentAt,
    'schema': schema,
    'addonVersion': addonVersion,
    'characters': characters,
  };

  /// Reads back [toJson], for the offline queue. [characters] stay as they are.
  factory SyncRequest.fromJson(Object? json) {
    final m = _map(json);
    return SyncRequest(
      sentAt: _field<int>(m, 'sentAt'),
      schema: _field<int>(m, 'schema'),
      addonVersion: _field<String>(m, 'addonVersion'),
      characters: _field<List<Object?>>(m, 'characters'),
    );
  }
}

enum SyncStatus {
  ok('ok'),
  untracked('untracked'),
  ownedByOther('owned_by_other'),
  rejected('rejected');

  const SyncStatus(this.wire);

  final String wire;

  static SyncStatus parse(String wire) => values.firstWhere(
    (s) => s.wire == wire,
    orElse: () => throw FormatException('unknown sync status "$wire"'),
  );
}

class SyncResult {
  const SyncResult({
    required this.key,
    required this.status,
    required this.acceptedEvents,
    required this.duplicateEvents,
    required this.flags,
  });

  final CharacterRef key;
  final SyncStatus status;
  final int acceptedEvents;
  final int duplicateEvents;
  final List<String> flags;

  factory SyncResult.fromJson(Object? json) {
    final m = _map(json);
    return SyncResult(
      key: CharacterRef.fromJson(m['key']),
      status: SyncStatus.parse(_field<String>(m, 'status')),
      acceptedEvents: _field<int>(m, 'acceptedEvents'),
      duplicateEvents: _field<int>(m, 'duplicateEvents'),
      flags: [
        for (final f in _field<List<Object?>>(m, 'flags'))
          f is String ? f : throw const FormatException('mistyped field "flags"'),
      ],
    );
  }
}

/// `sync.response.json`.
class SyncResponse {
  const SyncResponse({required this.heartbeatIntervalSec, required this.results});

  final int heartbeatIntervalSec;
  final List<SyncResult> results;

  factory SyncResponse.fromJson(Object? json) {
    final m = _map(json);
    return SyncResponse(
      heartbeatIntervalSec: _field<int>(m, 'heartbeatIntervalSec'),
      results: [for (final r in _field<List<Object?>>(m, 'results')) SyncResult.fromJson(r)],
    );
  }
}

Map<String, Object?> _map(Object? json) =>
    json is Map<String, Object?> ? json : throw const FormatException('expected a JSON object');

T _field<T>(Map<String, Object?> m, String name) {
  final v = m[name];
  if (v is T) return v;
  throw FormatException('missing or mistyped field "$name"');
}
