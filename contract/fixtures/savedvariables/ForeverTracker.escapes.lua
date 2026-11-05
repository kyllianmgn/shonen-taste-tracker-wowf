-- Escape and comment edge cases for the literal parser.
--[[ A block comment
     spanning several lines, with "quotes" and { braces } that must be ignored. ]]
--[==[ A level-2 block comment containing ]] that does not close it. ]==]
ForeverTrackerDB = {
  ["schema"] = 1, -- trailing line comment
  ["addonVersion"] = "0.1.0",
  ["settings"] = { ["interval"] = 15, ["levelPrompt"] = true, ["debug"] = false, },
  ["characters"] = {
    ["Player-4242-0A1B2C3D"] = {
      ["key"] = { ["region"] = "eu", ["firstName"] = "Davina", ["surname"] = "Asaria",
                  ["guid"] = "Player-4242-0A1B2C3D", ["realmName"] = 'CAMWOW EU5 Realm 1 PvE' },
      ["snapshot"] = {
        ["capturedAt"] = 1793900000, ["level"] = 23, ["money"] = 0,["ilvl"] = 21.5,
        ["guild"] = "Les \"Veilleurs\"",
        ["guildRank"] = 'L\'Officier',
        ["zone"] = "Bois de la P\195\169nombre",
        ["subZone"] = "Line one\nLine two\tTabbed\\Backslash",
        ["equipment"] = {
          { ["slot"] = 1, ["itemId"] = 7720,
            ["link"] = "\124cff1eff00\124Hitem:7720::::::::23:::::::::\124h[Whitemane's Chapeau]\124h\124r" },
          { ["slot"] = 5, ["itemId"] = 6060,
            ["link"] = "|cffffffff|Hitem:6060::::::::23:::::::::|h[Flax Vest]|h|r" },
        },
        ["professions"] = {},
        ["reputations"] = {}
      },
      ["events"] = {
        { ["id"] = "Player-4242-0A1B2C3D-1793899000-1", ["type"] = "SESSION_START", ["at"] = 1793899000,
          ["data"] = {} },
        { ["id"] = "Player-4242-0A1B2C3D-1793899100-2", ["type"] = "GUILD_CHANGE", ["at"] = 1793899100,
          ["data"] = { ["from"] = [[Ancienne -- pas un commentaire]], ["to"] = [==[Les "Veilleurs" ]] encore]==] } },
      }
    }
  }
}
