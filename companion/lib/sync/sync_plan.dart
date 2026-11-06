import '../api/api_models.dart';
import 'sent_state.dart';

/// The character entries worth sending from one SavedVariables file
/// (docs/01 « Lecture du fichier »).
///
/// A character goes out when its snapshot `capturedAt` is newer than the last one
/// sent, or when it has events whose id was not sent yet; only those events are
/// kept. The snapshot always goes with it since the contract requires one; the
/// server ignores an older snapshot. [force] ("Synchroniser maintenant") sends
/// every character with all its events.
List<Map<String, Object?>> planCharacters(
  List<Object?> characters,
  SentState sent, {
  bool force = false,
}) {
  final plan = <Map<String, Object?>>[];
  for (final c in characters) {
    final key = characterKeyOf(c);
    if (key == null) continue;
    c as Map;
    final snapshot = c['snapshot'];
    final capturedAt = snapshot is Map ? snapshot['capturedAt'] : null;
    final last = sent.lastCapturedAt(key);
    final newSnapshot = capturedAt is int && (last == null || capturedAt > last);
    final events = c['events'] is List ? c['events'] as List : const [];
    final newEvents = [
      for (final e in events)
        if (force || !(e is Map && e['id'] is String && sent.wasSent(e['id'] as String))) e,
    ];
    if (!force && !newSnapshot && newEvents.isEmpty) continue;
    plan.add({for (final e in c.entries) '${e.key}': e.value, 'events': newEvents});
  }
  return plan;
}

/// The most recent `SESSION_START` seen in [characters]: its time and character.
({int at, CharacterRef character})? lastSessionStart(List<Object?> characters) {
  ({int at, CharacterRef character})? best;
  for (final c in characters) {
    if (characterKeyOf(c) == null) continue;
    c as Map;
    final events = c['events'];
    if (events is! List) continue;
    for (final e in events) {
      if (e is! Map || e['type'] != 'SESSION_START') continue;
      final at = e['at'];
      if (at is! int || (best != null && at <= best.at)) continue;
      final key = c['key'] as Map;
      best = (
        at: at,
        character: CharacterRef(
          region: key['region'] as String,
          firstName: key['firstName'] as String,
          surname: key['surname'] as String,
        ),
      );
    }
  }
  return best;
}
