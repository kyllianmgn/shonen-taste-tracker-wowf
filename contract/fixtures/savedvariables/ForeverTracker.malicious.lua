-- Must be rejected as "non-literal expression" and never executed.
-- Contains: a function call, a string concatenation and a global variable in value positions.
ForeverTrackerDB = {
  ["schema"] = 1,
  ["addonVersion"] = "0.1.0",
  ["settings"] = { ["interval"] = 15, ["levelPrompt"] = true, ["debug"] = os.execute("calc") },
  ["characters"] = {
    ["Player-4242-0A1B2C3D"] = {
      ["key"] = { ["region"] = "eu", ["firstName"] = "Davina", ["surname"] = "Asa" .. "ria",
                  ["guid"] = "Player-4242-0A1B2C3D", ["realmName"] = SOME_GLOBAL },
      ["snapshot"] = { ["capturedAt"] = 1793900000, ["level"] = 23 },
      ["events"] = {}
    }
  }
}
