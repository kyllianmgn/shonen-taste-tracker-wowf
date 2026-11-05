import 'tray_state.dart';

/// What a tray menu click asks for; routed by `TrayActions`.
enum TrayAction { syncNow, pair, unpair, toggleStartWithWindows, openLogs, quit }

/// Toolkit-agnostic menu entry, mapped to tray_manager items by the controller.
class TrayMenuEntry {
  const TrayMenuEntry(this.label, {this.action, this.enabled = true, this.checked})
      : isSeparator = false;

  const TrayMenuEntry.separator()
      : label = '',
        action = null,
        enabled = false,
        checked = null,
        isSeparator = true;

  final String label;
  final TrayAction? action;
  final bool enabled;

  /// Non-null for checkbox entries.
  final bool? checked;
  final bool isSeparator;
}

/// Builds the menu from the docs/01 « Interface » list: status (character,
/// last sync, server), Synchroniser maintenant, Appairer / Délier,
/// Démarrer avec Windows, Ouvrir les logs, Quitter.
List<TrayMenuEntry> buildTrayMenu(TrayState state, {required bool startWithWindows}) {
  return [
    TrayMenuEntry('Statut : ${state.summary}', enabled: false),
    TrayMenuEntry('Perso : ${state.lastCharacter ?? 'aucun'}', enabled: false),
    TrayMenuEntry('Dernière synchro : ${_formatSync(state.lastSyncAt)}', enabled: false),
    TrayMenuEntry('Serveur : ${_serverLabel(state.server)}', enabled: false),
    const TrayMenuEntry.separator(),
    TrayMenuEntry('Synchroniser maintenant',
        action: TrayAction.syncNow, enabled: state.paired),
    state.paired
        ? const TrayMenuEntry('Délier', action: TrayAction.unpair)
        : const TrayMenuEntry('Appairer…', action: TrayAction.pair),
    TrayMenuEntry('Démarrer avec Windows',
        action: TrayAction.toggleStartWithWindows, checked: startWithWindows),
    const TrayMenuEntry('Ouvrir les logs', action: TrayAction.openLogs),
    const TrayMenuEntry.separator(),
    const TrayMenuEntry('Quitter', action: TrayAction.quit),
  ];
}

String _formatSync(DateTime? at) {
  if (at == null) return 'jamais';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(at.day)}/${two(at.month)} ${two(at.hour)}:${two(at.minute)}';
}

String _serverLabel(ServerStatus s) => switch (s) {
      ServerStatus.unknown => 'en attente',
      ServerStatus.ok => 'connecté',
      ServerStatus.unreachable => 'injoignable',
      ServerStatus.tokenRevoked => 'jeton révoqué',
    };
