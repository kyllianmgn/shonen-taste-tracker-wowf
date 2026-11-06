/// Windows notifications, only for blocking errors (docs/01 « Interface »).
/// The real one lives in `ui/notifications/` (it needs a plugin).
abstract interface class Notifier {
  Future<void> show({required String title, required String body});
}
