import 'package:flutter/foundation.dart';
import 'package:logging/logging.dart';

import '../../api/api_error.dart';
import '../../api/device_pairing.dart';
import '../../settings/app_settings.dart';
import '../../settings/settings_store.dart';
import '../../settings/startup_launcher.dart';
import '../../wow_files/forever_folder.dart';

/// The first-run window is shown at startup only while the app is not paired.
bool shouldShowFirstRun({required bool paired}) => !paired;

const _chooseFolderMessage =
    'Dossier du jeu introuvable. Choisis ton dossier World of Warcraft (celui qui contient _forever_).';

/// French message for a pairing failure, shown under the "Appairer" button.
String pairingErrorMessage(ApiException e) => switch (e) {
  CodeUnknown() =>
    'Code inconnu. Vérifie-le ou demande-en un nouveau avec /lier appli sur Discord.',
  CodeExpired() => 'Ce code a expiré (10 min). Demande-en un nouveau avec /lier appli sur Discord.',
  CodeUsed() => 'Ce code a déjà servi. Demande-en un nouveau avec /lier appli sur Discord.',
  RateLimited(:final retryAfter) =>
    'Trop d\'essais. Réessaie dans ${retryAfter == null ? 60 : retryAfter.inSeconds.clamp(1, 3600)} s.',
  NetworkError() => 'Serveur injoignable. Vérifie ta connexion Internet et réessaie.',
  ServerError() ||
  UnexpectedResponse() => 'Le serveur a rencontré un problème. Réessaie plus tard.',
  ValidationFailed() ||
  PayloadTooLarge() ||
  SchemaRejected() ||
  InvalidToken() => 'Le serveur a refusé la demande. Mets l\'appli à jour puis réessaie.',
  ApiNotConfigured() =>
    'Appli mal configurée : adresse du serveur absente. Télécharge la dernière version.',
};

/// State and steps of the first-run window (docs/01 « Premier lancement »):
/// game folder, pairing code, "Démarrer avec Windows".
class FirstRunController extends ChangeNotifier {
  FirstRunController({
    required this._locator,
    required this._pairing,
    required this._settings,
    required this._startup,
    required AppSettings initial,
  }) : _initial = initial,
       _startWithWindows = initial.startWithWindows;

  final ForeverFolderLocator _locator;
  final DevicePairing _pairing;
  final SettingsStore _settings;
  final StartupLauncher _startup;
  final AppSettings _initial;

  static final _log = Logger('first_run');

  String? _folder;
  String? _folderMessage;
  bool _startWithWindows;
  bool _busy = false;
  String? _error;

  /// The validated `_forever_` folder, or null while the player has to choose one.
  String? get folder => _folder;

  /// Why [folder] is missing, in French.
  String? get folderMessage => _folderMessage;
  bool get startWithWindows => _startWithWindows;

  /// A pairing request is in flight.
  bool get busy => _busy;

  /// Last pairing failure, in French.
  String? get error => _error;

  /// Uses the folder saved in settings if still valid, else tries the default locations.
  Future<void> init() async {
    final saved = _initial.gameFolder;
    String? found;
    if (saved != null) {
      final check = await _locator.check(saved);
      if (check.isValid) found = check.foreverPath;
    }
    found ??= await _locator.detect();
    _folder = found;
    _folderMessage = found == null ? _chooseFolderMessage : null;
    _log.info(found == null ? 'game folder not found, asking the player' : 'game folder: $found');
    notifyListeners();
  }

  Future<void> chooseFolder(String path) async {
    final check = await _locator.check(path);
    // A refused choice keeps the previous valid folder, if any.
    if (check.isValid) _folder = check.foreverPath;
    _folderMessage = check.problem?.message;
    _log.info(
      check.isValid
          ? 'game folder chosen: $_folder'
          : 'chosen folder refused: ${check.problem!.name}',
    );
    notifyListeners();
  }

  void setStartWithWindows(bool value) {
    _startWithWindows = value;
    notifyListeners();
  }

  /// Pairs with [rawCode]; on success saves the settings. Returns true when paired.
  Future<bool> submit(String rawCode) async {
    if (_busy) return false;
    final folder = _folder;
    if (folder == null) return _fail('Choisis d\'abord le dossier du jeu.');
    if (normalizePairingCode(rawCode) == null) {
      return _fail('Le code fait 8 caractères (lettres et chiffres, sans 0, O, 1 ni I).');
    }

    _busy = true;
    _error = null;
    notifyListeners();
    try {
      await _pairing.pairWithCode(rawCode);
      final next = (await _settings.load()).copyWith(
        gameFolder: folder,
        startWithWindows: _startWithWindows,
        firstRunCompleted: true,
      );
      await _startup.setEnabled(_startWithWindows);
      await _settings.save(next);
      return true;
    } on ApiException catch (e) {
      _log.warning('pairing failed: $e');
      _error = pairingErrorMessage(e);
      return false;
    } finally {
      _busy = false;
      notifyListeners();
    }
  }

  bool _fail(String message) {
    _error = message;
    notifyListeners();
    return false;
  }
}
