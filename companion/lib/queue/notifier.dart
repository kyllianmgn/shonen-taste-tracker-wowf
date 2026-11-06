/// Windows notifications: blocking errors (docs/01 « Interface ») and the
/// startup update notice (C-08). The real one lives in `ui/notifications/`
/// (it needs a plugin).
abstract interface class Notifier {
  /// [onClick] runs when the player clicks the notification.
  Future<void> show({
    required String title,
    required String body,
    Future<void> Function()? onClick,
  });
}
