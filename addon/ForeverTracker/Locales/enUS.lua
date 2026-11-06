-- ForeverTracker: English strings, the default for every client locale.
-- Other locale files only override the keys they translate.

local _, ns = ...

ns.L = {
  WARN_REGIONAL_NAMES = "regional unique names are disabled: the character key (region, first name, surname) may be ambiguous.",
  API_REPORT_TITLE = "APIs to check on this client:",
  API_STATUS = "API %s: %s",
  API_FOUND = "found",
  API_MISSING = "missing",
  API_FAILED = "found, error when called",
  API_PROFESSION_SOURCE = "professions read via %s",
  API_PROFESSION_NONE = "professions: no usable API",

  -- Sync.lua: "Synchroniser" window and key binding
  SYNC_PROMPT = "Send your progress to the bot? (2-3 s loading)",
  SYNC_BUTTON = "Sync",
  LATER_BUTTON = "Later",
  DONT_ASK = "Don't ask again this session",
  BINDING_SYNC = "ForeverTracker: sync now",
  SYNC_REFUSED = "Can't sync: %s.",
  REASON_NO_CHARACTER = "no character loaded yet",
  REASON_COMBAT = "you are in combat",
  REASON_INSTANCE = "you are in an instance",
  REASON_TAXI = "you are on a flight",
  REASON_DEAD = "your character is dead",
  REASON_CASTING = "a spell is being cast",

  -- Commands.lua: /ftr ("||" shows a single "|" in the chat)
  CMD_UNKNOWN = "Unknown command: %s",
  CMD_HELP_TITLE = "Commands:",
  CMD_USAGE = "Usage: %s",
  HELP_STATUS = "character, last save, interval, pending events",
  HELP_SYNC = "sync now (reloads the interface)",
  HELP_INTERVAL = "how often the Sync window shows up",
  HELP_LEVELPROMPT = "Sync window after each level",
  HELP_DEBUG = "diagnostic messages in the chat",
  HELP_RESET = "empty this character's journal",
  HELP_HELP = "this list",
  STATUS_NO_CHARACTER = "No character loaded yet.",
  STATUS_CHARACTER = "Character: %s (level %d)",
  STATUS_LAST_SAVE = "Last save: %d min ago",
  STATUS_INTERVAL = "Sync window: every %d min",
  STATUS_INTERVAL_OFF = "Sync window: off",
  STATUS_PENDING = "Pending events: %d",
  LEVELPROMPT_ON = "Sync window after each level: on",
  LEVELPROMPT_OFF = "Sync window after each level: off",
  DEBUG_ON = "Diagnostic messages: on",
  DEBUG_OFF = "Diagnostic messages: off",
  RESET_CONFIRM = "Empty this character's event journal? Events not synced yet will be lost.",
  RESET_ACCEPT = "Empty",
  RESET_CANCEL = "Cancel",
  RESET_DONE = "Journal emptied.",
  HELP_SHARE = "code to paste into /sync on Discord (without the app)",

  -- Share.lua: /ftr share window
  SHARE_HELP = "Copy this code (Ctrl+C) and paste it into /sync code: on Discord.",
  SHARE_DROPPED_EQUIPMENT = "Code shortened: equipment left out.",
  SHARE_DROPPED_REPUTATIONS = "Code shortened: reputations left out.",
  SHARE_DROPPED_BOTH = "Code shortened: equipment and reputations left out.",
  SHARE_TOO_LONG = "Long code (%d characters): if Discord refuses it, attach the ForeverTracker.lua file with /sync fichier: instead.",
}
