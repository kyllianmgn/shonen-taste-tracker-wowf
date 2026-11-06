import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/settings/startup_launcher.dart';

class MemoryRunKey implements RunKey {
  final values = <String, String>{};
  bool fail = false;

  @override
  String? read(String name) => values[name];

  @override
  void write(String name, String command) {
    if (fail) throw const RunKeyException('RegSetValueExW', 5);
    values[name] = command;
  }

  @override
  void delete(String name) {
    if (fail) throw const RunKeyException('RegDeleteKeyValueW', 5);
    values.remove(name);
  }
}

void main() {
  const exe = r'C:\Users\Jaina\AppData\Local\Programs\ForeverTracker Sync\forevertracker_sync.exe';
  late MemoryRunKey key;
  late RegistryStartupLauncher launcher;

  setUp(() {
    key = MemoryRunKey();
    launcher = RegistryStartupLauncher(runKey: key, executablePath: exe);
  });

  test('enabling writes the quoted exe path under the app name', () async {
    await launcher.setEnabled(true);
    expect(key.values, {'ForeverTracker Sync': '"$exe"'});
    expect(launcher.isEnabled, isTrue);
  });

  test('disabling removes the value; disabling twice is fine', () async {
    await launcher.setEnabled(true);
    await launcher.setEnabled(false);
    await launcher.setEnabled(false);
    expect(key.values, isEmpty);
    expect(launcher.isEnabled, isFalse);
  });

  test('enabling again repairs a stale path (app moved or reinstalled)', () async {
    key.values['ForeverTracker Sync'] = r'"C:\old\forevertracker_sync.exe"';
    expect(launcher.isEnabled, isFalse);
    await launcher.setEnabled(true);
    expect(key.values['ForeverTracker Sync'], '"$exe"');
  });

  test('leaves other Run entries alone', () async {
    key.values['Discord'] = 'discord.exe';
    await launcher.setEnabled(true);
    await launcher.setEnabled(false);
    expect(key.values, {'Discord': 'discord.exe'});
  });

  test('a registry failure is logged, not thrown', () async {
    key.fail = true;
    await launcher.setEnabled(true);
    await launcher.setEnabled(false);
    expect(key.values, isEmpty);
  });

  test('does not register a development build from build\\windows', () async {
    final dev = RegistryStartupLauncher(
      runKey: key,
      executablePath: r'C:\src\companion\build\windows\x64\runner\Debug\forevertracker_sync.exe',
    );
    await dev.setEnabled(true);
    expect(key.values, isEmpty);
  });

  test('applyAtStartup follows the setting once the first run is done', () async {
    await launcher.applyAtStartup(firstRunCompleted: true, startWithWindows: true);
    expect(key.values, isNotEmpty);
    await launcher.applyAtStartup(firstRunCompleted: true, startWithWindows: false);
    expect(key.values, isEmpty);
  });

  test('applyAtStartup does nothing before the first run (the window decides)', () async {
    await launcher.applyAtStartup(firstRunCompleted: false, startWithWindows: true);
    expect(key.values, isEmpty);
  });
}
