import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:logging/logging.dart';
import 'package:window_manager/window_manager.dart';

import 'api/pairing_service.dart';
import 'app/rotating_file_sink.dart';
import 'settings/app_paths.dart';
import 'settings/settings_store.dart';
import 'settings/startup_launcher.dart';
import 'sync/sync_service.dart';
import 'ui/tray/tray_actions.dart';
import 'ui/tray/tray_controller.dart';
import 'ui/tray/tray_state.dart';

final _log = Logger('app');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final paths = AppPaths.fromEnvironment(Platform.environment);
  setupLogging(RotatingFileSink(paths.logsDir));
  FlutterError.onError = (d) => _log.severe('flutter error', d.exception, d.stack);
  _log.info('starting ForeverTracker Sync');

  // The native runner never shows the window (windows/runner/flutter_window.cpp).
  // It stays hidden; the first-run window (C-05) will call windowManager.show().
  await windowManager.ensureInitialized();
  await windowManager.setPreventClose(true);
  await windowManager.setSkipTaskbar(true);
  await windowManager.hide();

  final store = SettingsStore(paths.settingsFile);
  final settings = await store.load();
  final pairing = NotImplementedPairingService();

  late final TrayController tray;
  tray = TrayController(
    initial: TrayState(paired: await pairing.isPaired()),
    settings: settings,
    buildActions: (emit) => TrayActions(
      sync: NotImplementedSyncService(),
      pairing: pairing,
      startup: NotImplementedStartupLauncher(),
      settings: store,
      openLogs: () => Process.run('explorer.exe', [paths.logsDir.path]),
      quit: () async {
        _log.info('quitting');
        await tray.dispose();
        await windowManager.setPreventClose(false);
        await windowManager.destroy();
      },
      emit: emit,
    ),
  );
  await tray.start();

  runApp(const CompanionApp());
}

/// Hidden host window. Closing it only hides it; "Quitter" exits the app.
class CompanionApp extends StatefulWidget {
  const CompanionApp({super.key});

  @override
  State<CompanionApp> createState() => _CompanionAppState();
}

class _CompanionAppState extends State<CompanionApp> with WindowListener {
  @override
  void initState() {
    super.initState();
    windowManager.addListener(this);
  }

  @override
  void dispose() {
    windowManager.removeListener(this);
    super.dispose();
  }

  @override
  void onWindowClose() => windowManager.hide();

  @override
  Widget build(BuildContext context) => const MaterialApp(
    title: 'ForeverTracker Sync',
    debugShowCheckedModeBanner: false,
    home: Scaffold(body: SizedBox.shrink()),
  );
}
