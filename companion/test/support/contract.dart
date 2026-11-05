import 'dart:convert';
import 'dart:io';

import 'package:json_schema/json_schema.dart' as js;

/// The repository's `contract/` folder, found by walking up from the test's working directory.
final Directory contractDir = () {
  var dir = Directory.current.absolute;
  while (true) {
    final candidate = Directory(_join([dir.path, 'contract']));
    if (File(_join([candidate.path, 'schemas', 'error.json'])).existsSync()) return candidate;
    final parent = dir.parent;
    if (parent.path == dir.path) throw StateError('contract/ not found above ${Directory.current}');
    dir = parent;
  }
}();

String _join(List<String> parts) => parts.join(Platform.pathSeparator);

Object? readContractJson(List<String> relative) =>
    jsonDecode(File(_join([contractDir.path, ...relative])).readAsStringSync());

Map<String, Object?> contractSchemaJson(String name) =>
    readContractJson(['schemas', '$name.json']) as Map<String, Object?>;

Map<String, Object?> contractFixture(String name) =>
    readContractJson(['fixtures', name]) as Map<String, Object?>;

List<int> savedVariablesFixture(String name) =>
    File(_join([contractDir.path, 'fixtures', 'savedvariables', name])).readAsBytesSync();

final _validators = <String, js.JsonSchema>{};

/// Validator for `contract/schemas/<name>.json` (draft 2020-12).
js.JsonSchema contractSchema(String name) => _validators.putIfAbsent(
  name,
  () => js.JsonSchema.create(
    contractSchemaJson(name),
    schemaVersion: js.SchemaVersion.draft2020_12,
  ),
);

/// The validation errors of [instance] against [name], empty when valid.
List<String> contractErrors(String name, Object? instance) {
  final result = contractSchema(name).validate(instance, validateFormats: true);
  return [for (final e in result.errors) e.toString()];
}
