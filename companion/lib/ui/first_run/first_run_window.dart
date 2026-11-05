import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'first_run_controller.dart';

/// The single window of the first launch: game folder, pairing code,
/// "Démarrer avec Windows". Also opened by the tray's "Appairer".
class FirstRunWindow extends StatefulWidget {
  const FirstRunWindow({
    super.key,
    required this.controller,
    required this.pickFolder,
    required this.onPaired,
  });

  final FirstRunController controller;

  /// Native folder dialog; null when the player cancels.
  final Future<String?> Function() pickFolder;
  final VoidCallback onPaired;

  @override
  State<FirstRunWindow> createState() => _FirstRunWindowState();
}

class _FirstRunWindowState extends State<FirstRunWindow> {
  final _code = TextEditingController();

  FirstRunController get _c => widget.controller;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _choose() async {
    final path = await widget.pickFolder();
    if (path != null) await _c.chooseFolder(path);
  }

  Future<void> _submit() async {
    if (await _c.submit(_code.text)) {
      _code.clear();
      widget.onPaired();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: ListenableBuilder(
        listenable: _c,
        builder: (context, _) => SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Bienvenue dans ForeverTracker Sync', style: theme.textTheme.titleLarge),
              const SizedBox(height: 4),
              const Text(
                "L'appli envoie la progression de tes personnages au bot Discord, sans rien changer au jeu.",
              ),
              const SizedBox(height: 24),
              Text('1. Dossier du jeu', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: _c.folder != null
                        ? SelectableText(_c.folder!)
                        : Text(
                            _c.folderMessage ?? '',
                            style: TextStyle(color: theme.colorScheme.error),
                          ),
                  ),
                  const SizedBox(width: 12),
                  OutlinedButton(
                    onPressed: _c.busy ? null : _choose,
                    child: const Text('Choisir…'),
                  ),
                ],
              ),
              if (_c.folder != null && _c.folderMessage != null)
                Text(_c.folderMessage!, style: TextStyle(color: theme.colorScheme.error)),
              const SizedBox(height: 24),
              Text("2. Code d'appairage", style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              TextField(
                controller: _code,
                enabled: !_c.busy,
                autofocus: true,
                maxLength: 9,
                textCapitalization: TextCapitalization.characters,
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9 -]'))],
                decoration: const InputDecoration(
                  border: OutlineInputBorder(),
                  hintText: 'K7P29QXM',
                  helperText: 'Tape /lier appli sur Discord pour obtenir ton code (8 caractères).',
                ),
                onSubmitted: (_) => _submit(),
              ),
              const SizedBox(height: 8),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
                title: const Text('Démarrer avec Windows'),
                value: _c.startWithWindows,
                onChanged: _c.busy ? null : (v) => _c.setStartWithWindows(v ?? true),
              ),
              const SizedBox(height: 8),
              if (_c.error != null) ...[
                Text(_c.error!, style: TextStyle(color: theme.colorScheme.error)),
                const SizedBox(height: 8),
              ],
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton(
                  onPressed: _c.busy ? null : _submit,
                  child: _c.busy
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Appairer'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
