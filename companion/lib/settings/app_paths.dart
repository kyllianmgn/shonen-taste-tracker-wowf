import 'dart:io';

/// Locations of the app's local files, all under `%APPDATA%\ForeverTrackerSync`.
class AppPaths {
  AppPaths(this.dataDir);

  /// Builds the paths from the process environment (`Platform.environment`).
  factory AppPaths.fromEnvironment(Map<String, String> environment) {
    final appData = environment['APPDATA'];
    if (appData == null || appData.isEmpty) {
      throw StateError('APPDATA is not set; cannot locate the settings folder');
    }
    return AppPaths(Directory(_join(appData, folderName)));
  }

  static const folderName = 'ForeverTrackerSync';

  final Directory dataDir;

  File get settingsFile => File(_join(dataDir.path, 'settings.json'));

  /// Rotating log files live next to the settings, as the spec requires.
  Directory get logsDir => dataDir;

  /// Offline queue folder (filled in C-07).
  Directory get queueDir => Directory(_join(dataDir.path, 'queue'));

  static String _join(String a, String b) => '$a${Platform.pathSeparator}$b';
}
