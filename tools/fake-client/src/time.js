/**
 * Moves a fixture payload to the present. Fixtures carry fixed Unix times (T0 = 1793900000); the
 * server rejects times more than 5 min ahead and presence only counts recent ones, so replays need
 * current times. `sentAt` lands `offsetSec` seconds from now; `capturedAt` and events' `at` keep
 * their distance to `sentAt`.
 */
export function retime(payload, { nowSec, offsetSec = 0 }) {
  if (typeof payload?.sentAt !== 'number') throw new Error('la fixture doit avoir un sentAt numérique');
  const delta = Math.trunc(nowSec) + offsetSec - payload.sentAt;
  const out = structuredClone(payload);
  out.sentAt += delta;
  for (const character of out.characters ?? []) {
    if (typeof character.snapshot?.capturedAt === 'number') character.snapshot.capturedAt += delta;
    for (const event of character.events ?? []) {
      if (typeof event.at !== 'number') continue;
      event.id = retimeEventId(event.id, event.at, event.at + delta);
      event.at += delta;
    }
  }
  return out;
}

/**
 * Addon event ids are `<guid>-<at>-<seq>`: the time in the id moves with `at`, so replaying a
 * fixture later gives new events instead of duplicates. Other ids are kept.
 */
function retimeEventId(id, oldAt, newAt) {
  if (typeof id !== 'string') return id;
  const suffix = new RegExp(`-${oldAt}-(\\d+)$`);
  return id.replace(suffix, `-${newAt}-$1`);
}
