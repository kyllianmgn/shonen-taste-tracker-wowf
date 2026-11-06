import 'dart:async';

import 'package:local_notifier/local_notifier.dart';
import 'package:logging/logging.dart';

import '../../queue/notifier.dart';

/// Windows toast through local_notifier. [setup] creates the Start menu shortcut
/// Windows needs to show toasts for a desktop app.
class WindowsNotifier implements Notifier {
  static final _log = Logger('notify');

  bool _ready = false;

  Future<void> setup(String appName) async {
    try {
      await localNotifier.setup(appName: appName);
      _ready = true;
    } catch (e) {
      _log.warning('Windows notifications unavailable: ${e.runtimeType}');
    }
  }

  @override
  Future<void> show({
    required String title,
    required String body,
    Future<void> Function()? onClick,
  }) async {
    if (!_ready) {
      _log.warning('notification not shown (not set up): $title');
      return;
    }
    final notification = LocalNotification(title: title, body: body);
    if (onClick != null) notification.onClick = () => unawaited(onClick());
    await localNotifier.notify(notification);
  }
}
