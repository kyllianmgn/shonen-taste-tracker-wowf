/// Tray icon state machine. Pure Dart: no Flutter import, so it is unit-tested
/// without a window.
///
/// Spec (docs/01, « Interface ») : green = game detected and last send OK,
/// grey = game closed, orange = error. An error stays visible even when the
/// game is closed, and "not paired" counts as an error since nothing can be sent.
library;

enum TrayColor { green, grey, orange }

/// Reasons for an orange icon, highest priority first.
enum TrayIssue { tokenRevoked, notPaired, unknownSchema, serverUnreachable }

enum ServerStatus { unknown, ok, unreachable, tokenRevoked }

sealed class TrayEvent {
  const TrayEvent();
}

/// Game process detected (C-04).
class GameStarted extends TrayEvent {
  const GameStarted();
}

/// Game process gone (C-04).
class GameStopped extends TrayEvent {
  const GameStopped();
}

/// A heartbeat or a sync was accepted by the server (C-06, C-07).
class SendSucceeded extends TrayEvent {
  const SendSucceeded(this.at, {this.isSync = false, this.character});
  final DateTime at;
  final bool isSync;

  /// Display name of the last character seen, when known.
  final String? character;
}

/// Network error, 5xx or 429: the request went to the offline queue (C-07).
class SendFailed extends TrayEvent {
  const SendFailed();
}

/// SavedVariables file with an unknown `schema` (C-06).
class UnknownSchema extends TrayEvent {
  const UnknownSchema();
}

/// Server answered 401: the device token was revoked (C-07).
class Unauthorized extends TrayEvent {
  const Unauthorized();
}

/// Pairing succeeded (C-05).
class Paired extends TrayEvent {
  const Paired();
}

/// The user unpaired the app (C-05).
class Unpaired extends TrayEvent {
  const Unpaired();
}

class TrayState {
  const TrayState({
    this.paired = false,
    this.gameRunning = false,
    this.tokenRevoked = false,
    this.unknownSchema = false,
    this.lastSendFailed = false,
    this.anySendSucceeded = false,
    this.lastSyncAt,
    this.lastCharacter,
  });

  final bool paired;
  final bool gameRunning;
  final bool tokenRevoked;
  final bool unknownSchema;
  final bool lastSendFailed;
  final bool anySendSucceeded;
  final DateTime? lastSyncAt;
  final String? lastCharacter;

  TrayState apply(TrayEvent event) => switch (event) {
    GameStarted() => _copy(gameRunning: true),
    GameStopped() => _copy(gameRunning: false),
    SendSucceeded(:final at, :final isSync, :final character) => _copy(
      lastSendFailed: false,
      unknownSchema: false,
      anySendSucceeded: true,
      lastSyncAt: isSync ? at : lastSyncAt,
      lastCharacter: character ?? lastCharacter,
    ),
    SendFailed() => _copy(lastSendFailed: true),
    UnknownSchema() => _copy(unknownSchema: true),
    Unauthorized() => _copy(paired: false, tokenRevoked: true),
    Paired() => _copy(paired: true, tokenRevoked: false, lastSendFailed: false),
    Unpaired() => _copy(paired: false, tokenRevoked: false),
  };

  TrayIssue? get issue {
    if (tokenRevoked) return TrayIssue.tokenRevoked;
    if (!paired) return TrayIssue.notPaired;
    if (unknownSchema) return TrayIssue.unknownSchema;
    if (lastSendFailed) return TrayIssue.serverUnreachable;
    return null;
  }

  TrayColor get color {
    if (issue != null) return TrayColor.orange;
    return gameRunning ? TrayColor.green : TrayColor.grey;
  }

  ServerStatus get server {
    if (tokenRevoked) return ServerStatus.tokenRevoked;
    if (lastSendFailed) return ServerStatus.unreachable;
    if (anySendSucceeded) return ServerStatus.ok;
    return ServerStatus.unknown;
  }

  /// One-line French summary, used for the tooltip and the menu status line.
  String get summary => switch (issue) {
    TrayIssue.tokenRevoked => "Jeton révoqué : réappaire l'appli avec /lier appli",
    TrayIssue.notPaired => "Non appairée : tape /lier appli sur Discord",
    TrayIssue.unknownSchema => "Format de fichier inconnu : mets à jour l'appli",
    TrayIssue.serverUnreachable => 'Serveur injoignable, nouvel essai automatique',
    null => gameRunning ? 'Jeu détecté, synchro OK' : 'Jeu fermé',
  };

  String get tooltip => 'ForeverTracker Sync — $summary';

  TrayState _copy({
    bool? paired,
    bool? gameRunning,
    bool? tokenRevoked,
    bool? unknownSchema,
    bool? lastSendFailed,
    bool? anySendSucceeded,
    DateTime? lastSyncAt,
    String? lastCharacter,
  }) => TrayState(
    paired: paired ?? this.paired,
    gameRunning: gameRunning ?? this.gameRunning,
    tokenRevoked: tokenRevoked ?? this.tokenRevoked,
    unknownSchema: unknownSchema ?? this.unknownSchema,
    lastSendFailed: lastSendFailed ?? this.lastSendFailed,
    anySendSucceeded: anySendSucceeded ?? this.anySendSucceeded,
    lastSyncAt: lastSyncAt ?? this.lastSyncAt,
    lastCharacter: lastCharacter ?? this.lastCharacter,
  );
}
