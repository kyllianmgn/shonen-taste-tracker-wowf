/// Server address, set at build time:
/// `flutter run -d windows --dart-define=API_BASE_URL=http://localhost:3000`.
const apiBaseUrlDefine = String.fromEnvironment('API_BASE_URL');

/// The base URL without its trailing slash, or null when [raw] is empty or not
/// a plain `http(s)://host[/path]` URL.
Uri? parseApiBaseUrl(String raw) {
  final uri = Uri.tryParse(raw.trim());
  if (uri == null || !(uri.isScheme('http') || uri.isScheme('https'))) return null;
  if (uri.host.isEmpty || uri.hasQuery || uri.hasFragment || uri.userInfo.isNotEmpty) return null;
  var path = uri.path;
  while (path.endsWith('/')) {
    path = path.substring(0, path.length - 1);
  }
  return uri.replace(path: path);
}
