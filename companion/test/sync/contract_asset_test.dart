import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import '../support/contract.dart';

void main() {
  test('the bundled sync.request schema is the one of contract/schemas', () {
    final bundled = jsonDecode(File('assets/contract/sync.request.json').readAsStringSync());
    expect(bundled, contractSchemaJson('sync.request'));
  });
}
