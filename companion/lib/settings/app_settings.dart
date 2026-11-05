/// User settings persisted in `settings.json`.
///
/// Holds no secret: the device token goes to the Windows Credential Manager
/// (C-05), never here.
class AppSettings {
  const AppSettings({
    this.gameFolder,
    this.startWithWindows = true,
    this.firstRunCompleted = false,
  });

  /// Bumped when the file layout changes in a non-compatible way.
  static const currentVersion = 1;

  /// Path of the `_forever_` folder, once detected or chosen (C-03, C-05).
  final String? gameFolder;

  /// "Démarrer avec Windows", on by default per the spec.
  final bool startWithWindows;

  /// Whether the first-run window (C-05) has been completed.
  final bool firstRunCompleted;

  AppSettings copyWith({
    String? gameFolder,
    bool? startWithWindows,
    bool? firstRunCompleted,
  }) =>
      AppSettings(
        gameFolder: gameFolder ?? this.gameFolder,
        startWithWindows: startWithWindows ?? this.startWithWindows,
        firstRunCompleted: firstRunCompleted ?? this.firstRunCompleted,
      );

  Map<String, Object?> toJson() => {
        'version': currentVersion,
        'gameFolder': gameFolder,
        'startWithWindows': startWithWindows,
        'firstRunCompleted': firstRunCompleted,
      };

  /// Lenient: a missing or mistyped key keeps its default, unknown keys are
  /// ignored, so a hand-edited file never prevents the app from starting.
  factory AppSettings.fromJson(Map<String, Object?> json) {
    const defaults = AppSettings();
    final gameFolder = json['gameFolder'];
    final startWithWindows = json['startWithWindows'];
    final firstRunCompleted = json['firstRunCompleted'];
    return AppSettings(
      gameFolder: gameFolder is String ? gameFolder : defaults.gameFolder,
      startWithWindows: startWithWindows is bool
          ? startWithWindows
          : defaults.startWithWindows,
      firstRunCompleted: firstRunCompleted is bool
          ? firstRunCompleted
          : defaults.firstRunCompleted,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is AppSettings &&
      other.gameFolder == gameFolder &&
      other.startWithWindows == startWithWindows &&
      other.firstRunCompleted == firstRunCompleted;

  @override
  int get hashCode => Object.hash(gameFolder, startWithWindows, firstRunCompleted);

  @override
  String toString() => 'AppSettings(gameFolder: $gameFolder, '
      'startWithWindows: $startWithWindows, '
      'firstRunCompleted: $firstRunCompleted)';
}
