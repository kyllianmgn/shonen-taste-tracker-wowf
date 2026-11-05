import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:forevertracker_sync/wow_files/forever_folder.dart';

import 'wow_tree.dart';

void main() {
  late WowTree tree;

  setUp(() => tree = WowTree.create());
  tearDown(() => tree.delete());

  group('default candidates', () {
    test('follow the spec order: Program Files (x86) then Program Files', () {
      expect(ForeverFolderLocator.defaultCandidates, [
        r'C:\Program Files (x86)\World of Warcraft\_forever_',
        r'C:\Program Files\World of Warcraft\_forever_',
      ]);
    });
  });

  group('detect', () {
    test('returns the first candidate that has a WTF folder', () async {
      final second = WowTree.create();
      addTearDown(second.delete);
      tree.createWtf();
      second.createWtf();

      final locator = ForeverFolderLocator(candidates: [tree.forever, second.forever]);
      expect(await locator.detect(), tree.forever);
    });

    test('skips a candidate whose _forever_ folder has no WTF', () async {
      Directory(tree.forever).createSync(recursive: true);
      final second = WowTree.create();
      addTearDown(second.delete);
      second.createWtf();

      final locator = ForeverFolderLocator(candidates: [tree.forever, second.forever]);
      expect(await locator.detect(), second.forever);
    });

    test('returns null when no candidate is valid, so the player must choose', () async {
      final locator = ForeverFolderLocator(candidates: [tree.forever, WowTree.p(tree.root, 'nope')]);
      expect(await locator.detect(), isNull);
    });
  });

  group('check (manual choice)', () {
    const locator = ForeverFolderLocator(candidates: []);

    test('accepts the World of Warcraft folder and resolves _forever_', () async {
      tree.createWtf();
      final result = await locator.check(tree.root);
      expect(result.isValid, isTrue);
      expect(result.foreverPath, tree.forever);
      expect(result.problem, isNull);
    });

    test('accepts the _forever_ folder itself, with or without a trailing separator', () async {
      tree.createWtf();
      expect((await locator.check(tree.forever)).foreverPath, tree.forever);
      expect(
        (await locator.check('${tree.forever}${Platform.pathSeparator}')).foreverPath,
        tree.forever,
      );
    });

    test('reports a folder that does not exist', () async {
      final result = await locator.check(WowTree.p(tree.root, 'missing'));
      expect(result.isValid, isFalse);
      expect(result.problem, ForeverFolderProblem.notFound);
      expect(result.foreverPath, isNull);
    });

    test('reports a WoW folder without _forever_', () async {
      final result = await locator.check(tree.root);
      expect(result.problem, ForeverFolderProblem.noForeverFolder);
    });

    test('reports a _forever_ folder without WTF', () async {
      Directory(tree.forever).createSync(recursive: true);
      final result = await locator.check(tree.root);
      expect(result.problem, ForeverFolderProblem.noWtf);
    });

    test('every problem has a French message for the first-run window', () {
      for (final problem in ForeverFolderProblem.values) {
        expect(problem.message, isNotEmpty);
      }
      expect(ForeverFolderProblem.noWtf.message, contains('WTF'));
    });
  });
}
