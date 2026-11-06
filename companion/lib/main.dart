import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:logging/logging.dart';
import 'package:window_manager/window_manager.dart';

import 'api/api_client.dart';
import 'api/api_config.dart';
import 'api/credential_manager_token_store.dart';
import 'api/device_pairing.dart';
import 'api/pairing_service.dart';
import 'app/app_info.dart';
import 'app/rotating_file_sink.dart';
import 'process/win32_process_lister.dart';
import 'settings/app_paths.dart';
import 'settings/app_settings.dart';
import 'settings/settings_store.dart';
import 'settings/startup_launcher.dart';
import 'sync/game_folder_session.dart';
import 'sync/sent_state.dart';
import 'sync/sync_runtime.dart';
import 'ui/first_run/first_run_controller.dart';
import 'ui/first_run/first_run_window.dart';
import 'ui/tray/tray_actions.dart';
import 'ui/tray/tray_controller.dart';
import 'ui/tray/tray_state.dart';
import 'wow_files/forever_folder.dart';

final _log = Logger('app');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final paths = AppPaths.fromEnvironment(Platform.environment);
  setupLogging(RotatingFileSink(paths.logsDir));
  FlutterError.onError = (d) => _log.severe('flutter error', d.exception, d.stack);
  _log.info('starting ForeverTracker Sync $appVersion');

  // The native runner never shows the window (windows/runner/flutter_window.cpp).
  // It stays hidden unless the first-run window is needed.
  await windowManager.ensureInitialized();
  await windowManager.setPreventClose(true);
  await windowManager.setSkipTaskbar(true);
  await windowManager.hide();

  final baseUrl = parseApiBaseUrl(apiBaseUrlDefine);
  if (baseUrl == null) {
    _log.severe('API_BASE_URL is missing or invalid: build with --dart-define=API_BASE_URL=…');
  }
  final apiClient = ApiClient(baseUrl: baseUrl, httpClient: http.Client());
  final tokenStore = CredentialManagerTokenStore();
  final devicePairing = DevicePairing(
    client: apiClient,
    store: tokenStore,
    deviceName: deviceNameFor(Platform.localHostname),
    appVersion: appVersion,
  );

  final store = SettingsStore(paths.settingsFile);
  final settings = await store.load();
  final startup = NotImplementedStartupLauncher();

  late final TrayController tray;
  final syncRequestSchema = jsonDecode(
    await rootBundle.loadString('assets/contract/sync.request.json'),
  ) as Map<String, Object?>;
  final sentState = FileSentStateStore(paths.sentStateFile);
  final processLister = Win32ProcessLister();
  final sync = SyncRuntime(
    (folder) => GameFolderSyncSession(
      gameFolder: folder,
      processLister: processLister,
      api: apiClient,
      tokens: tokenStore,
      sentState: sentState,
      syncRequestSchema: syncRequestSchema,
      emit: (e) => tray.dispatch(e),
      appVersion: appVersion,
    ),
  );

  final firstRun = FirstRunPresenter(
    build: (current) => FirstRunController(
      locator: const ForeverFolderLocator(),
      pairing: devicePairing,
      settings: store,
      startup: startup,
      initial: current,
    ),
    settings: store,
    onSettingsChanged: (s) {
      tray.updateSettings(s);
      unawaited(sync.setGameFolder(s.gameFolder));
    },
  );
  final pairing = WindowPairingService(pairing: devicePairing, showPairingWindow: firstRun.present);
  final paired = await pairing.isPaired();

  tray = TrayController(
    initial: TrayState(paired: paired),
    settings: settings,
    buildActions: (emit) => TrayActions(
      sync: sync,
      pairing: pairing,
      startup: startup,
      settings: store,
      openLogs: () => Process.run('explorer.exe', [paths.logsDir.path]),
      quit: () async {
        _log.info('quitting');
        await sync.dispose();
        await tray.dispose();
        await windowManager.setPreventClose(false);
        await windowManager.destroy();
      },
      emit: (event) {
        emit(event);
        // Newly paired: send everything the files hold.
        if (event is Paired) unawaited(sync.syncNow());
      },
    ),
  );
  await tray.start();
  unawaited(sync.setGameFolder(settings.gameFolder));

  runApp(CompanionApp(firstRun: firstRun));

  if (shouldShowFirstRun(paired: paired)) {
    unawaited(
      firstRun.present().then((ok) {
        if (!ok) return;
        tray.dispatch(const Paired());
        unawaited(sync.syncNow());
      }),
    );
  }
}

/// Shows the first-run window on demand (startup, tray "Appairer") and reports how it ended.
class FirstRunPresenter {
  FirstRunPresenter({required this.build, required this.settings, required this.onSettingsChanged});

  final FirstRunController Function(AppSettings current) build;
  final SettingsStore settings;
  final void Function(AppSettings settings) onSettingsChanged;

  final current = ValueNotifier<FirstRunController?>(null);
  Completer<bool>? _done;

  /// Completes with true once paired, false when the player closes the window.
  Future<bool> present() async {
    final running = _done;
    if (running != null) {
      await windowManager.focus();
      return running.future;
    }
    final done = _done = Completer<bool>();
    final controller = build(await settings.load());
    await controller.init();
    current.value = controller;
    await windowManager.setTitle('ForeverTracker Sync');
    await windowManager.setSize(const Size(560, 620));
    await windowManager.center();
    await windowManager.setSkipTaskbar(false);
    await windowManager.show();
    await windowManager.focus();
    return done.future;
  }

  Future<void> paired() async {
    onSettingsChanged(await settings.load());
    await _finish(true);
  }

  Future<void> closed() => _finish(false);

  Future<void> _finish(bool ok) async {
    await windowManager.hide();
    await windowManager.setSkipTaskbar(true);
    final controller = current.value;
    current.value = null;
    controller?.dispose();
    _done?.complete(ok);
    _done = null;
  }
}

Future<String?> _pickFolder() =>
    getDirectoryPath(confirmButtonText: 'Choisir', initialDirectory: r'C:\Program Files (x86)');

/// Host window, hidden except for the first-run window. Closing it only hides
/// it; "Quitter" exits the app.
class CompanionApp extends StatefulWidget {
  const CompanionApp({super.key, required this.firstRun});

  final FirstRunPresenter firstRun;

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
  void onWindowClose() => widget.firstRun.closed();

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'ForeverTracker Sync',
    debugShowCheckedModeBanner: false,
    home: ValueListenableBuilder(
      valueListenable: widget.firstRun.current,
      builder: (context, controller, _) => controller == null
          ? const Scaffold(body: SizedBox.shrink())
          : FirstRunWindow(
              key: ObjectKey(controller),
              controller: controller,
              pickFolder: _pickFolder,
              onPaired: widget.firstRun.paired,
            ),
    ),
  );
}
