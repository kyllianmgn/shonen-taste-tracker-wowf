import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/update/update_checker.dart';
import 'package:forevertracker_sync/update/version.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

const _repoUrl = 'https://github.com/shokkzu/forever-tracker';

Map<String, Object?> release(
  String tag, {
  bool draft = false,
  bool prerelease = false,
  List<String> assets = const [],
}) => {
  'tag_name': tag,
  'draft': draft,
  'prerelease': prerelease,
  'html_url': '$_repoUrl/releases/tag/$tag',
  'assets': [
    for (final a in assets)
      {'name': a, 'browser_download_url': '$_repoUrl/releases/download/$tag/$a'},
  ],
};

void main() {
  late List<http.Request> requests;

  UpdateChecker checker(
    Object? body, {
    int status = 200,
    String current = '1.0.0',
    String repo = 'shokkzu/forever-tracker',
  }) {
    requests = [];
    return UpdateChecker(
      repo: repo,
      current: Version.parse(current)!,
      httpClient: MockClient((r) async {
        requests.add(r);
        return http.Response(
          jsonEncode(body),
          status,
          headers: {'content-type': 'application/json'},
        );
      }),
    );
  }

  test('asks the GitHub releases API of the configured repo', () async {
    await checker([]).check();
    expect(requests.single.method, 'GET');
    expect(
      requests.single.url.toString(),
      'https://api.github.com/repos/shokkzu/forever-tracker/releases?per_page=50',
    );
    expect(requests.single.headers['Accept'], 'application/vnd.github+json');
    expect(requests.single.headers['User-Agent'], 'ForeverTrackerSync/1.0.0');
    expect(requests.single.headers.containsKey('Authorization'), isFalse);
  });

  test('newer companion release: returns its version and installer link', () async {
    final update = await checker([
      release('companion-v1.2.0', assets: ['notes.txt', 'ForeverTrackerSync-Setup-1.2.0.exe']),
    ]).check();
    expect(update, isNotNull);
    expect(update!.version, Version.parse('1.2.0'));
    expect(
      update.downloadUrl.toString(),
      '$_repoUrl/releases/download/companion-v1.2.0/ForeverTrackerSync-Setup-1.2.0.exe',
    );
  });

  test('no installer asset: links the release page', () async {
    final update = await checker([release('companion-v1.2.0')]).check();
    expect(update!.downloadUrl.toString(), '$_repoUrl/releases/tag/companion-v1.2.0');
  });

  test('picks the highest version, whatever the API order', () async {
    final update = await checker([
      release('companion-v1.1.0'),
      release('companion-v1.10.0'),
      release('companion-v1.9.0'),
    ]).check();
    expect(update!.version, Version.parse('1.10.0'));
  });

  test('same or older version: nothing to do', () async {
    expect(await checker([release('companion-v1.0.0')]).check(), isNull);
    expect(await checker([release('companion-v0.9.0')]).check(), isNull);
  });

  test('ignores addon releases, drafts, pre-releases and pre-release tags', () async {
    final update = await checker([
      release('addon-v9.0.0'),
      release('companion-v3.0.0', draft: true),
      release('companion-v2.0.0', prerelease: true),
      release('companion-v1.5.0-test'),
      release('companion-v1.1.0'),
    ]).check();
    expect(update!.version, Version.parse('1.1.0'));
  });

  test('a pre-release build is offered the final release', () async {
    final update = await checker([release('companion-v1.0.0')], current: '1.0.0-beta.1').check();
    expect(update!.version, Version.parse('1.0.0'));
  });

  test('only follows https links to github.com', () async {
    final evil = release('companion-v2.0.0', assets: ['ForeverTrackerSync-Setup-2.0.0.exe']);
    ((evil['assets'] as List).first as Map)['browser_download_url'] = 'https://evil.example/s.exe';
    evil['html_url'] = 'http://github.com/x';
    expect(await checker([evil]).check(), isNull);

    final pageOnly = release('companion-v2.0.0', assets: ['ForeverTrackerSync-Setup-2.0.0.exe']);
    ((pageOnly['assets'] as List).first as Map)['browser_download_url'] =
        'https://evil.example/s.exe';
    final update = await checker([pageOnly]).check();
    expect(update!.downloadUrl.toString(), '$_repoUrl/releases/tag/companion-v2.0.0');
  });

  group('never throws: a failure means "no update"', () {
    test('HTTP error', () async {
      expect(await checker({'message': 'rate limited'}, status: 403).check(), isNull);
      expect(await checker([], status: 500).check(), isNull);
    });

    test('malformed body', () async {
      expect(await checker({'not': 'a list'}).check(), isNull);
      expect(await checker(['nope', 3, null]).check(), isNull);
      expect(
        await checker([
          {'tag_name': 5},
        ]).check(),
        isNull,
      );
    });

    test('network error', () async {
      final c = UpdateChecker(
        repo: 'shokkzu/forever-tracker',
        current: Version.parse('1.0.0')!,
        httpClient: MockClient((_) async => throw http.ClientException('offline')),
      );
      expect(await c.check(), isNull);
    });

    test('invalid repo setting: no request at all', () async {
      for (final repo in ['', 'noslash', 'a/b/c', '../x', 'a b/c', 'a/..']) {
        expect(await checker([], repo: repo).check(), isNull, reason: repo);
        expect(requests, isEmpty, reason: repo);
      }
    });
  });
}
