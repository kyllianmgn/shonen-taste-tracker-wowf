-- ForeverTracker: French strings, applied over enUS on a frFR client.

local _, ns = ...

if GetLocale() ~= "frFR" then return end

local L = ns.L
L.WARN_REGIONAL_NAMES = "les noms uniques régionaux sont désactivés : la clé du personnage (région, prénom, nom) peut être ambiguë."
L.API_REPORT_TITLE = "API à vérifier sur ce client :"
L.API_STATUS = "API %s : %s"
L.API_FOUND = "trouvée"
L.API_MISSING = "absente"
L.API_FAILED = "trouvée, erreur à l'appel"
L.API_PROFESSION_SOURCE = "métiers lus via %s"
L.API_PROFESSION_NONE = "métiers : aucune API utilisable"

-- Sync.lua
L.SYNC_PROMPT = "Envoyer ta progression au bot ? (2-3 s de chargement)"
L.SYNC_BUTTON = "Synchroniser"
L.LATER_BUTTON = "Plus tard"
L.DONT_ASK = "Ne plus demander cette session"
L.BINDING_SYNC = "ForeverTracker : synchroniser maintenant"
L.SYNC_REFUSED = "Synchronisation impossible : %s."
L.REASON_NO_CHARACTER = "aucun perso chargé"
L.REASON_COMBAT = "tu es en combat"
L.REASON_INSTANCE = "tu es en instance"
L.REASON_TAXI = "tu es en vol"
L.REASON_DEAD = "ton perso est mort"
L.REASON_CASTING = "une incantation est en cours"

-- Commands.lua
L.CMD_UNKNOWN = "Commande inconnue : %s"
L.CMD_HELP_TITLE = "Commandes :"
L.CMD_USAGE = "Utilisation : %s"
L.HELP_STATUS = "perso, dernière sauvegarde, intervalle, événements en attente"
L.HELP_SYNC = "synchroniser tout de suite (recharge l'interface)"
L.HELP_INTERVAL = "fréquence de la fenêtre Synchroniser"
L.HELP_LEVELPROMPT = "fenêtre Synchroniser après chaque niveau"
L.HELP_DEBUG = "messages de diagnostic dans le chat"
L.HELP_RESET = "vider le journal de ce perso"
L.HELP_HELP = "cette liste"
L.STATUS_NO_CHARACTER = "Aucun perso chargé."
L.STATUS_CHARACTER = "Perso : %s (niveau %d)"
L.STATUS_LAST_SAVE = "Dernière sauvegarde : il y a %d min"
L.STATUS_INTERVAL = "Fenêtre Synchroniser : toutes les %d min"
L.STATUS_INTERVAL_OFF = "Fenêtre Synchroniser : désactivée"
L.STATUS_PENDING = "Événements en attente : %d"
L.LEVELPROMPT_ON = "Fenêtre après chaque niveau : activée"
L.LEVELPROMPT_OFF = "Fenêtre après chaque niveau : désactivée"
L.DEBUG_ON = "Messages de diagnostic : activés"
L.DEBUG_OFF = "Messages de diagnostic : désactivés"
L.RESET_CONFIRM = "Vider le journal d'événements de ce perso ? Les événements pas encore synchronisés seront perdus."
L.RESET_ACCEPT = "Vider"
L.RESET_CANCEL = "Annuler"
L.RESET_DONE = "Journal vidé."
