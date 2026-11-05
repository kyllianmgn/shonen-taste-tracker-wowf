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
