import type { ManualSyncOutcome, ManualSyncRefusal } from '../../ingest/share-code/manual-sync.service';
import type { SyncFlag } from '../../ingest/sync/sync-rules';
import type { SyncResult } from '../../ingest/sync/sync.types';

/** Ephemeral answers of /sync (docs/02 « Commande /sync »). French only. */
export const SYNC_MSG = {
  usage:
    'ℹ️ Donne **soit** `code` (le texte de `/ftr share` dans le jeu), **soit** `fichier` (ton `ForeverTracker.lua`, dossier `WTF/Account/<compte>/SavedVariables`).',
  codeFormat: '❌ Ce n’est pas un code ForeverTracker : il doit commencer par `FT1:`. Copie tout le texte de `/ftr share`.',
  codeCorrupt: '❌ Code illisible : il est sans doute incomplet. Recopie tout le texte de `/ftr share`, ou envoie ton fichier avec `fichier`.',
  tooLarge: '❌ Trop gros : 512 Ko au maximum.',
  downloadFailed: '❌ Impossible de récupérer la pièce jointe. Réessaie dans un instant.',
  notLiteral: '❌ Fichier refusé : il contient autre chose que des données (expression non littérale). Envoie le `ForeverTracker.lua` écrit par l’addon.',
  luaSyntax: '❌ Fichier illisible : ce n’est pas un `ForeverTracker.lua` valide.',
  empty: '❌ Aucun perso dans ce fichier. Connecte-toi au jeu avec l’addon, puis `/reload` ou déconnecte-toi avant de l’envoyer.',
  unknownSchema: '❌ Version de l’addon inconnue du bot. Mets l’addon à jour ou attends la mise à jour du bot.',
  invalid: '❌ Données refusées : elles ne respectent pas le format attendu',
} as const;

const REFUSALS: Record<Exclude<ManualSyncRefusal, 'invalid'>, string> = {
  code_format: SYNC_MSG.codeFormat,
  code_corrupt: SYNC_MSG.codeCorrupt,
  too_large: SYNC_MSG.tooLarge,
  download_failed: SYNC_MSG.downloadFailed,
  not_literal: SYNC_MSG.notLiteral,
  lua_syntax: SYNC_MSG.luaSyntax,
  empty: SYNC_MSG.empty,
  unknown_schema: SYNC_MSG.unknownSchema,
};

const FLAG_LABELS: Record<SyncFlag, string> = {
  regression: 'niveau ou temps joué en baisse',
  future_timestamp: 'date dans le futur',
  level_above_cap: 'niveau au-delà du maximum',
  suspect_level_jump: 'saut de niveau suspect',
};

/** Pure rendering of a ManualSyncService outcome. */
export function renderManualSyncReply(outcome: ManualSyncOutcome): string {
  switch (outcome.status) {
    case 'rate_limited':
      return `⏳ Une synchro toutes les 2 minutes au plus. Réessaie dans ${outcome.retryAfterSec} s.`;
    case 'refused':
      return outcome.reason === 'invalid'
        ? `${SYNC_MSG.invalid}${outcome.detail ? ` (champ \`${outcome.detail}\`)` : ''}`
        : REFUSALS[outcome.reason];
    case 'done':
      return [summary(outcome.results), ...outcome.results.map(line)].join('\n');
  }
}

function summary(results: SyncResult[]): string {
  const stored = results.filter((r) => r.status === 'ok' || r.status === 'untracked');
  const accepted = stored.reduce((n, r) => n + r.acceptedEvents, 0);
  const duplicates = stored.reduce((n, r) => n + r.duplicateEvents, 0);
  return `📥 **Synchro reçue** : ${count(stored.length, 'perso mis à jour', 'persos mis à jour')}, ${events(accepted, duplicates)}.`;
}

function line(r: SyncResult): string {
  const name = `${r.key.firstName} ${r.key.surname}${r.key.region === 'eu' ? '' : ` (${r.key.region.toUpperCase()})`}`;
  switch (r.status) {
    case 'owned_by_other':
      return `⛔ ${name} : ce perso appartient à un autre membre, rien n’a été enregistré`;
    case 'rejected':
      return `❌ ${name} : refusé (${r.flags.map((f) => FLAG_LABELS[f]).join(', ')})`;
    case 'untracked':
      return `➖ ${name} (non suivi) : ${events(r.acceptedEvents, r.duplicateEvents)}`;
    case 'ok':
      return r.flags.includes('suspect_level_jump')
        ? `⚠️ ${name} : ${events(r.acceptedEvents, r.duplicateEvents)} — saut de niveau suspect : enregistré mais pas annoncé`
        : `✅ ${name} : ${events(r.acceptedEvents, r.duplicateEvents)}`;
  }
}

function events(accepted: number, duplicates: number): string {
  return `${count(accepted, 'événement accepté', 'événements acceptés')}, ${count(duplicates, 'doublon', 'doublons')}`;
}

/** French plural: 0 and 1 take the singular. */
function count(n: number, singular: string, plural: string): string {
  return `${n} ${n > 1 ? plural : singular}`;
}
