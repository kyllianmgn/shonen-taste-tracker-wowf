/** User-facing strings shared by every command (French only, docs/03 « Langue du bot »). */
export const MSG = {
  comingSoon: '🚧 Bientôt disponible.',
  genericError: '❌ Une erreur est survenue. Réessaie dans un instant.',
  guildOnly: '❌ Cette commande s’utilise sur un serveur.',
  manageGuildRequired: '❌ Cette commande demande la permission « Gérer le serveur ».',
  missingPermissions:
    '❌ Discord a refusé l’opération : il me manque des permissions. Vérifie mon rôle et les permissions de la catégorie, puis relance la commande.',
} as const;
