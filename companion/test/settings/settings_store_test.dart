import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/settings/app_paths.dart';
import 'package:forevertracker_sync/settings/app_settings.dart';
import 'package:forevertracker_sync/settings/settings_store.dart';

void main() {
  late Directory tmp;
  late File file;
  late SettingsStore store;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('ftsync_settings_');
    file = File('${tmp.path}${Platform.pathSeparator}sub'
        '${Platform.pathSeparator}settings.json');
    store = SettingsStore(file);
  });

  tearDown(() => tmp.deleteSync(recursive: true));

  group('AppPaths', () {
    test('resolves everything under %APPDATA%\\ForeverTrackerSync', () {
      final paths = AppPaths.fromEnvironment({'APPDATA': r'C:\Users\x\AppData\Roaming'});
      expect(paths.dataDir.path, r'C:\Users\x\AppData\Roaming\ForeverTrackerSync');
      expect(paths.settingsFile.path,
          r'C:\Users\x\AppData\Roaming\ForeverTrackerSync\settings.json');
      expect(paths.logsDir.path, paths.dataDir.path);
    });

    test('fails clearly when APPDATA is missing', () {
      expect(() => AppPaths.fromEnvironment({}), throwsStateError);
    });
  });

  group('SettingsStore.load', () {
    test('returns defaults when the file does not exist', () async {
      final s = await store.load();
      expect(s, const AppSettings());
      expect(s.startWithWindows, isTrue);
      expect(s.firstRunCompleted, isFalse);
      expect(s.gameFolder, isNull);
    });

    test('returns defaults when the file is not valid JSON', () async {
      file.parent.createSync(recursive: true);
      file.writeAsStringSync('{ not json');
      expect(await store.load(), const AppSettings());
    });

    test('returns defaults when the JSON is not an object', () async {
      file.parent.createSync(recursive: true);
      file.writeAsStringSync('[1, 2]');
      expect(await store.load(), const AppSettings());
    });

    test('keeps defaults for missing or mistyped keys and ignores unknown keys',
        () async {
      file.parent.createSync(recursive: true);
      file.writeAsStringSync(jsonEncode({
        'version': 1,
        'gameFolder': r'C:\Games\World of Warcraft\_forever_',
        'startWithWindows': 'yes',
        'somethingElse': 42,
      }));
      final s = await store.load();
      expect(s.gameFolder, r'C:\Games\World of Warcraft\_forever_');
      expect(s.startWithWindows, isTrue);
      expect(s.firstRunCompleted, isFalse);
    });
  });

  group('SettingsStore.save', () {
    test('round-trips every field and creates the folder', () async {
      const s = AppSettings(
        gameFolder: r'C:\Program Files (x86)\World of Warcraft\_forever_',
        startWithWindows: false,
        firstRunCompleted: true,
      );
      await store.save(s);
      expect(file.existsSync(), isTrue);
      expect(await SettingsStore(file).load(), s);
    });

    test('writes a versioned, human-readable JSON file', () async {
      await store.save(const AppSettings());
      final raw = file.readAsStringSync();
      expect(raw, contains('\n  '));
      final json = jsonDecode(raw) as Map<String, dynamic>;
      expect(json['version'], AppSettings.currentVersion);
      expect(json.containsKey('gameFolder'), isTrue);
    });

    test('overwrites the previous file and leaves no temp file behind',
        () async {
      await store.save(const AppSettings(startWithWindows: false));
      await store.save(const AppSettings(firstRunCompleted: true));
      expect((await store.load()).startWithWindows, isTrue);
      expect(file.parent.listSync().map((e) => e.uri.pathSegments.last),
          ['settings.json']);
    });
  });

  test('copyWith changes only the given fields', () {
    const s = AppSettings(gameFolder: 'a');
    final t = s.copyWith(startWithWindows: false);
    expect(t.gameFolder, 'a');
    expect(t.startWithWindows, isFalse);
    expect(t.firstRunCompleted, isFalse);
  });
}
