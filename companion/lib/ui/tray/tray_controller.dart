import 'package:logging/logging.dart';
import 'package:tray_manager/tray_manager.dart';

import '../../settings/app_settings.dart';
import 'tray_actions.dart';
import 'tray_menu.dart';
import 'tray_state.dart';

/// Thin adapter between the pure tray model and tray_manager.
/// All decisions live in [TrayState], [buildTrayMenu] and [TrayActions].
class TrayController with TrayListener {
  TrayController({
    required TrayState initial,
    required AppSettings settings,
    required TrayActions Function(void Function(TrayEvent) emit) buildActions,
  }) : _state = initial,
       _appSettings = settings {
    _actions = buildActions(dispatch);
  }

  static final _log = Logger('tray');

  late final TrayActions _actions;
  TrayState _state;
  AppSettings _appSettings;
  TrayColor? _shownColor;

  TrayState get state => _state;

  Future<void> start() async {
    trayManager.addListener(this);
    await _render();
  }

  Future<void> dispose() async {
    trayManager.removeListener(this);
    await trayManager.destroy();
  }

  /// Settings changed outside the tray menu (first-run window).
  void updateSettings(AppSettings settings) {
    _appSettings = settings;
    _render();
  }

  /// Entry point for every state change (game detection, sends, pairing).
  void dispatch(TrayEvent event) {
    final previous = _state;
    _state = _state.apply(event);
    if (_state.color != previous.color) {
      _log.info(
        'tray ${previous.color.name} -> ${_state.color.name} '
        '(${event.runtimeType})',
      );
    }
    _render();
  }

  Future<void> _render() async {
    if (_state.color != _shownColor) {
      await trayManager.setIcon('assets/tray/${_state.color.name}.ico');
      _shownColor = _state.color;
    }
    await trayManager.setToolTip(_state.tooltip);
    await trayManager.setContextMenu(
      Menu(
        items: [
          for (final e in buildTrayMenu(_state, startWithWindows: _appSettings.startWithWindows))
            if (e.isSeparator)
              MenuItem.separator()
            else if (e.checked != null)
              MenuItem.checkbox(
                key: e.action?.name,
                label: e.label,
                checked: e.checked,
                disabled: !e.enabled,
              )
            else
              MenuItem(key: e.action?.name, label: e.label, disabled: !e.enabled),
        ],
      ),
    );
  }

  @override
  void onTrayIconMouseDown() => trayManager.popUpContextMenu();

  @override
  void onTrayIconRightMouseDown() => trayManager.popUpContextMenu();

  @override
  Future<void> onTrayMenuItemClick(MenuItem menuItem) async {
    final key = menuItem.key;
    if (key == null) return;
    final action = TrayAction.values.asNameMap()[key];
    if (action == null) return;
    try {
      final updated = await _actions.handle(action);
      if (updated != null) _appSettings = updated;
    } catch (e, st) {
      _log.severe('tray action ${action.name} failed', e, st);
    }
    if (action != TrayAction.quit) await _render();
  }
}
