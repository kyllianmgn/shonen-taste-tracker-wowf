import { ButtonStyle, ComponentType } from 'discord.js';
import { privacyReply, QUIT_CONFIRM_TTL_MS, QUIT_IDS, QUIT_MSG, quitPrompt } from './privacy-replies';

const ALL_VISIBLE = { hideMoney: false, hideZone: false, hidePresence: false };

describe('privacyReply', () => {
  it('shows the current settings and how to change them', () => {
    const text = privacyReply(ALL_VISIBLE, false);
    expect(text).toContain('**Ta confidentialité**');
    expect(text).toContain('Or : visible');
    expect(text).toContain('Zone : visible');
    expect(text).toContain('Statut en ligne : visible');
    expect(text).toContain('/confidentialite');
  });

  it('confirms an update and marks each hidden value', () => {
    const text = privacyReply({ hideMoney: true, hideZone: false, hidePresence: true }, true);
    expect(text).toContain('✅ Confidentialité mise à jour');
    expect(text).toContain('Or : masqué');
    expect(text).toContain('Zone : visible');
    expect(text).toContain('Statut en ligne : masqué');
  });

  it('says where hidden values disappear', () => {
    expect(privacyReply(ALL_VISIBLE, true)).toMatch(/tableau.*\/profil.*\/classement.*logs/s);
  });
});

describe('quitPrompt', () => {
  const now = new Date('2026-11-07T10:00:00Z');

  it('warns, shows the 60 s deadline and offers confirm and cancel buttons', () => {
    const prompt = quitPrompt(now);
    const deadline = Math.floor((now.getTime() + QUIT_CONFIRM_TTL_MS) / 1000);
    expect(QUIT_CONFIRM_TTL_MS).toBe(60_000);
    expect(prompt.content).toContain('définitif');
    expect(prompt.content).toContain(`<t:${deadline}:R>`);
    expect(prompt.components).toEqual([
      {
        type: ComponentType.ActionRow,
        components: [
          expect.objectContaining({ type: ComponentType.Button, style: ButtonStyle.Danger, custom_id: QUIT_IDS.confirm }),
          expect.objectContaining({ type: ComponentType.Button, style: ButtonStyle.Secondary, custom_id: QUIT_IDS.cancel }),
        ],
      },
    ]);
  });

  it('has French messages for every outcome', () => {
    expect(QUIT_MSG.done).toContain('appareils');
    expect(QUIT_MSG.expired).toContain('/quitter');
    expect(QUIT_MSG.nothing).toBeTruthy();
    expect(QUIT_MSG.cancelled).toBeTruthy();
  });
});
