/// The device token returned by `POST /v1/devices/pair`.
///
/// Wrapped so it cannot end up in a log line or an error message by accident:
/// [toString] never prints the value. Only the HTTP client and the token store
/// read [value].
class DeviceToken {
  const DeviceToken(this.value);

  final String value;

  @override
  bool operator ==(Object other) => other is DeviceToken && other.value == value;

  @override
  int get hashCode => value.hashCode;

  @override
  String toString() => 'DeviceToken(<redacted>)';
}
