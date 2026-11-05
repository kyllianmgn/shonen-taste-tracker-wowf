import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/wow_files/saved_variables_discovery.dart';

import 'wow_tree.dart';

void main() {
  late WowTree tree;

  setUp(() {
    tree = WowTree.create();
    tree.createWtf();
  });
  tearDown(() => tree.delete());

  test('finds ForeverTracker.lua in every account, sorted', () async {
    tree.writeFile(tree.savedVariables('ZED'), 'x');
    tree.writeFile(tree.savedVariables('ALPHA'), 'x');
    tree.writeFile(tree.savedVariables('12345#1'), 'x');

    expect(await discoverSavedVariables(tree.forever), [
      tree.savedVariables('12345#1'),
      tree.savedVariables('ALPHA'),
      tree.savedVariables('ZED'),
    ]);
  });

  test(
    'ignores other addons, backups, accounts without the file and per-character folders',
    () async {
      tree.writeFile(tree.savedVariables('A'), 'x');
      tree.writeFile(tree.savedVariables('A', file: 'ForeverTracker.lua.bak'), 'x');
      tree.writeFile(tree.savedVariables('A', file: 'OtherAddon.lua'), 'x');
      tree.writeFile(tree.savedVariables('B', file: 'OtherAddon.lua'), 'x');
      Directory(WowTree.p(tree.wtf, 'Account', 'C')).createSync(recursive: true);
      tree.writeFile(
        WowTree.p(
          tree.wtf,
          'Account',
          'A',
          'Realm',
          'Char',
          'SavedVariables',
          'ForeverTracker.lua',
        ),
        'x',
      );
      // A folder named like the file is not a file.
      Directory(tree.savedVariables('D')).createSync(recursive: true);

      expect(await discoverSavedVariables(tree.forever), [tree.savedVariables('A')]);
    },
  );

  test('matches folder and file names case-insensitively, like Windows', () async {
    final path = WowTree.p(tree.wtf, 'Account', 'A', 'savedvariables', 'forevertracker.lua');
    tree.writeFile(path, 'x');

    expect(await discoverSavedVariables(tree.forever), [path]);
  });

  test('returns an empty list when WTF\\Account does not exist yet', () async {
    expect(await discoverSavedVariables(tree.forever), isEmpty);
  });

  test('isSavedVariablesFile recognises only the discovered pattern', () {
    expect(isSavedVariablesFile(tree.forever, tree.savedVariables('A')), isTrue);
    expect(isSavedVariablesFile(tree.forever, tree.savedVariables('A').toUpperCase()), isTrue);
    expect(
      isSavedVariablesFile(tree.forever, tree.savedVariables('A', file: 'ForeverTracker.lua.bak')),
      isFalse,
    );
    expect(
      isSavedVariablesFile(
        tree.forever,
        WowTree.p(tree.wtf, 'Account', 'A', 'R', 'C', 'SavedVariables', 'ForeverTracker.lua'),
      ),
      isFalse,
    );
    expect(isSavedVariablesFile(tree.forever, WowTree.p(tree.wtf, 'Config.wtf')), isFalse);
  });
}
