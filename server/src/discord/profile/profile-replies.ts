/** Replies of /profil and /session that are not a render (French, docs/03 « Langue du bot »). */
export const PROFILE_MSG = {
  notMember: (userId: string) => `<@${userId}> n’a aucun perso suivi sur ce serveur.`,
  noMain: (userId: string) => `<@${userId}> n’a pas de perso principal. Choisis un perso avec l’option \`perso\`.`,
  characterNotFound: '❌ Perso introuvable parmi les persos suivis de ce membre.',
  noSession: (userId: string) => `<@${userId}> n’a encore aucune session enregistrée.`,
} as const;

/** Public answer that mentions members without pinging them. */
export function publicReply(content: string): { content: string; allowedMentions: { parse: [] } } {
  return { content, allowedMentions: { parse: [] } };
}
