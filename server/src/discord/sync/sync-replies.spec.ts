import { renderManualSyncReply, SYNC_MSG } from './sync-replies';

const davina = { region: 'eu', firstName: 'Davina', surname: 'Asaria' } as const;
const morwen = { region: 'eu', firstName: 'Morwen', surname: 'Sombrelune' } as const;

describe('renderManualSyncReply', () => {
  it('summarizes updated characters, accepted events and duplicates', () => {
    const text = renderManualSyncReply({
      status: 'done',
      results: [
        { key: davina, status: 'ok', acceptedEvents: 3, duplicateEvents: 1, flags: [] },
        { key: morwen, status: 'untracked', acceptedEvents: 0, duplicateEvents: 0, flags: [] },
      ],
    });

    expect(text).toBe(
      [
        '📥 **Synchro reçue** : 2 persos mis à jour, 3 événements acceptés, 1 doublon.',
        '✅ Davina Asaria : 3 événements acceptés, 1 doublon',
        '➖ Morwen Sombrelune (non suivi) : 0 événement accepté, 0 doublon',
      ].join('\n'),
    );
  });

  it('explains refused characters: another member, regression, future, cap, suspect jump', () => {
    const text = renderManualSyncReply({
      status: 'done',
      results: [
        { key: davina, status: 'owned_by_other', acceptedEvents: 0, duplicateEvents: 0, flags: [] },
        { key: morwen, status: 'rejected', acceptedEvents: 0, duplicateEvents: 0, flags: ['regression', 'future_timestamp', 'level_above_cap'] },
        { key: { region: 'us', firstName: 'Kael', surname: 'Ombre' }, status: 'ok', acceptedEvents: 8, duplicateEvents: 0, flags: ['suspect_level_jump'] },
      ],
    });

    expect(text.split('\n')).toEqual([
      '📥 **Synchro reçue** : 1 perso mis à jour, 8 événements acceptés, 0 doublon.',
      '⛔ Davina Asaria : ce perso appartient à un autre membre, rien n’a été enregistré',
      '❌ Morwen Sombrelune : refusé (niveau ou temps joué en baisse, date dans le futur, niveau au-delà du maximum)',
      '⚠️ Kael Ombre (US) : 8 événements acceptés, 0 doublon — saut de niveau suspect : enregistré mais pas annoncé',
    ]);
  });

  it.each([
    ['code_format', SYNC_MSG.codeFormat],
    ['code_corrupt', SYNC_MSG.codeCorrupt],
    ['too_large', SYNC_MSG.tooLarge],
    ['download_failed', SYNC_MSG.downloadFailed],
    ['not_literal', SYNC_MSG.notLiteral],
    ['lua_syntax', SYNC_MSG.luaSyntax],
    ['empty', SYNC_MSG.empty],
    ['unknown_schema', SYNC_MSG.unknownSchema],
  ] as const)('explains the refusal %s', (reason, message) => {
    expect(renderManualSyncReply({ status: 'refused', reason })).toBe(message);
  });

  it('names the invalid field', () => {
    expect(renderManualSyncReply({ status: 'refused', reason: 'invalid', detail: '/character/snapshot/level' })).toBe(
      `${SYNC_MSG.invalid} (champ \`/character/snapshot/level\`)`,
    );
  });

  it('gives the wait when rate limited', () => {
    expect(renderManualSyncReply({ status: 'rate_limited', retryAfterSec: 75 })).toBe(
      '⏳ Une synchro toutes les 2 minutes au plus. Réessaie dans 75 s.',
    );
  });
});
