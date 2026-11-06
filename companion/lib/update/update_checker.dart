import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:logging/logging.dart';

import 'version.dart';

/// A newer companion release the player can download.
class UpdateInfo {
  const UpdateInfo({required this.version, required this.downloadUrl});

  final Version version;

  /// The installer asset, or the release page when it has none.
  final Uri downloadUrl;
}

abstract interface class UpdateSource {
  /// The newest release above the running version, or null. Never throws.
  Future<UpdateInfo?> check();
}

/// Looks for a newer `companion-v*` release on GitHub. Anonymous call (60
/// requests per hour per IP, plenty for one check per start). Drafts,
/// pre-releases and pre-release tags are skipped: test tags never reach
/// players. Nothing is downloaded or installed here (no silent update in v1).
class UpdateChecker implements UpdateSource {
  UpdateChecker({
    required this.repo,
    required this.current,
    required http.Client httpClient,
    this.timeout = const Duration(seconds: 15),
  }) : _http = httpClient;

  static final _log = Logger('update');
  static final _repoPattern = RegExp(r'^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$');
  static final _installerName = RegExp(r'^ForeverTrackerSync-Setup-.*\.exe$');

  /// `owner/name` of the GitHub repository.
  final String repo;
  final Version current;
  final Duration timeout;
  final http.Client _http;

  @override
  Future<UpdateInfo?> check() async {
    if (!_repoPattern.hasMatch(repo) || repo.split('/').last.startsWith('.')) {
      _log.warning('update check skipped: invalid repository setting');
      return null;
    }
    try {
      final response = await _http
          .get(
            Uri.https('api.github.com', '/repos/$repo/releases', {'per_page': '50'}),
            headers: {
              'Accept': 'application/vnd.github+json',
              'User-Agent': 'ForeverTrackerSync/$current',
            },
          )
          .timeout(timeout);
      if (response.statusCode != 200) {
        _log.info('update check: GitHub answered ${response.statusCode}');
        return null;
      }
      final releases = jsonDecode(utf8.decode(response.bodyBytes));
      if (releases is! List) return null;
      UpdateInfo? best;
      for (final r in releases) {
        final info = _candidate(r);
        if (info != null && (best == null || info.version > best.version)) best = info;
      }
      if (best == null || best.version <= current) {
        _log.info('update check: $current is up to date');
        return null;
      }
      _log.info('update check: ${best.version} available');
      return best;
    } catch (e) {
      // Network errors, timeouts, bad JSON: try again at the next start.
      _log.info('update check failed: ${e.runtimeType}');
      return null;
    }
  }

  UpdateInfo? _candidate(Object? release) {
    if (release is! Map) return null;
    if (release['draft'] == true || release['prerelease'] == true) return null;
    final tag = release['tag_name'];
    final version = tag is String ? Version.fromTag(tag) : null;
    if (version == null || version.isPreRelease) return null;
    final url = _installerUrl(release['assets']) ?? _gitHubUrl(release['html_url']);
    return url == null ? null : UpdateInfo(version: version, downloadUrl: url);
  }

  static Uri? _installerUrl(Object? assets) {
    if (assets is! List) return null;
    for (final a in assets) {
      if (a is Map && a['name'] is String && _installerName.hasMatch(a['name'] as String)) {
        final url = _gitHubUrl(a['browser_download_url']);
        if (url != null) return url;
      }
    }
    return null;
  }

  /// Only https links to github.com are ever opened from the tray.
  static Uri? _gitHubUrl(Object? raw) {
    if (raw is! String) return null;
    final uri = Uri.tryParse(raw);
    if (uri == null || !uri.isScheme('https') || uri.host != 'github.com') return null;
    if (uri.userInfo.isNotEmpty || uri.hasPort) return null;
    return uri;
  }
}
