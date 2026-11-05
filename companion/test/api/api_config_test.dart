import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/api/api_config.dart';
import 'package:forevertracker_sync/app/app_info.dart';

void main() {
  group('parseApiBaseUrl', () {
    test('accepts http and https URLs, without the trailing slash', () {
      expect(parseApiBaseUrl('https://forever.example.test'), Uri.parse('https://forever.example.test'));
      expect(parseApiBaseUrl('http://localhost:3000/'), Uri.parse('http://localhost:3000'));
      expect(parseApiBaseUrl(' https://x.test/api// '), Uri.parse('https://x.test/api'));
    });

    test('returns null when missing or not an http(s) URL', () {
      expect(parseApiBaseUrl(''), isNull);
      expect(parseApiBaseUrl('localhost:3000'), isNull);
      expect(parseApiBaseUrl('ftp://x.test'), isNull);
      expect(parseApiBaseUrl('https://'), isNull);
      expect(parseApiBaseUrl('https://x.test/?q=1'), isNull);
    });
  });

  test('appVersion matches pubspec.yaml and fits the contract (20 chars max)', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    final version = RegExp(r'^version:\s*([^+\s]+)', multiLine: true).firstMatch(pubspec)!.group(1);
    expect(appVersion, version);
    expect(appVersion.length, lessThanOrEqualTo(20));
  });
}
