import 'dart:convert';
import 'dart:io';

import 'package:logging/logging.dart';

/// `region/firstName/surname` of a normalized character entry (the server's key),
/// or null when the entry has no usable key.
String? characterKeyOf(Object? character) {
  if (character is! Map) return null;
  final key = character['key'];
  if (key is! Map) return null;
  final region = key['region'];
  final first = key['firstName'];
  final surname = key['surname'];
  if (region is! String || first is! String || surname is! String) return null;
  return '$region/$first/$surname';
}

/// What was already accepted by the server (docs/01 « Lecture du fichier »):
/// the last snapshot `capturedAt` per character and the 1 000 most recent event ids.
class SentState {
  SentState({this.maxEventIds = 1000});

  final int maxEventIds;
  final _capturedAt = <String, int>{};

  /// Insertion order = send order; the oldest ids are dropped first.
  final _eventIds = <String>{};

  int? lastCapturedAt(String characterKey) => _capturedAt[characterKey];

  bool wasSent(String eventId) => _eventIds.contains(eventId);

  int get eventIdCount => _eventIds.length;

  /// Records the character entries of a sync the server answered.
  void markSent(List<Object?> characters) {
    for (final c in characters) {
      final key = characterKeyOf(c);
      if (key == null) continue;
      c as Map;
      final snapshot = c['snapshot'];
      final capturedAt = snapshot is Map ? snapshot['capturedAt'] : null;
      if (capturedAt is int && capturedAt > (_capturedAt[key] ?? -1)) {
        _capturedAt[key] = capturedAt;
      }
      final events = c['events'];
      if (events is! List) continue;
      for (final e in events) {
        final id = e is Map ? e['id'] : null;
        if (id is String) _addId(id);
      }
    }
  }

  void _addId(String id) {
    _eventIds
      ..remove(id)
      ..add(id);
    while (_eventIds.length > maxEventIds) {
      _eventIds.remove(_eventIds.first);
    }
  }

  Map<String, Object?> toJson() => {
    'version': 1,
    'snapshots': Map<String, int>.of(_capturedAt),
    'eventIds': _eventIds.toList(),
  };

  /// Lenient: mistyped parts are ignored.
  factory SentState.fromJson(Map<String, Object?> json) {
    final state = SentState();
    final snapshots = json['snapshots'];
    if (snapshots is Map) {
      for (final MapEntry(:key, :value) in snapshots.entries) {
        if (key is String && value is int) state._capturedAt[key] = value;
      }
    }
    final ids = json['eventIds'];
    if (ids is List) {
      for (final id in ids) {
        if (id is String) state._addId(id);
      }
    }
    return state;
  }
}

abstract interface class SentStateStore {
  Future<SentState> load();

  Future<void> save(SentState state);
}

/// `%APPDATA%\ForeverTrackerSync\sync-state.json`. Holds ids and timestamps only.
class FileSentStateStore implements SentStateStore {
  FileSentStateStore(this.file);

  final File file;

  static final _log = Logger('sync');

  /// Empty state when the file is missing or unreadable: the server deduplicates anyway.
  @override
  Future<SentState> load() async {
    if (!await file.exists()) return SentState();
    try {
      final decoded = jsonDecode(await file.readAsString());
      if (decoded is Map<String, Object?>) return SentState.fromJson(decoded);
      _log.warning('sync-state.json is not a JSON object; starting empty');
    } on FormatException catch (e) {
      _log.warning('sync-state.json is not valid JSON (${e.message}); starting empty');
    } on FileSystemException catch (e) {
      _log.warning('cannot read sync-state.json (${e.osError?.message}); starting empty');
    }
    return SentState();
  }

  /// Temp file then rename, like `settings.json`.
  @override
  Future<void> save(SentState state) async {
    await file.parent.create(recursive: true);
    final tmp = File('${file.path}.tmp');
    await tmp.writeAsString(jsonEncode(state.toJson()), flush: true);
    await tmp.rename(file.path);
  }
}
