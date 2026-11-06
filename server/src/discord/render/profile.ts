/**
 * Pure rendering of /profil, /session and /classement (docs/02 « Commandes Discord » → Joueur).
 *
 * No Discord client, no database: ProfileQueryService maps rows into the input types below.
 * Privacy (/confidentialite) is applied here, so every output goes through the same rules:
 * hide_money drops the gold (and the player from the gold ranking), hide_zone drops the zone,
 * hide_presence drops what tells when the player plays (last sync, session times, live session).
 */

/** Discord limit of a message `content`. */
export const MAX_REPLY_CHARS = 2000;
export const LEADERBOARD_SIZE = 15;
/** Reputation standing (`reaction`) from which a faction is shown: 6 = Honoré. */
export const MIN_SHOWN_STANDING = 6;
/** Pace ranking only counts characters with at least this much played time (seconds). */
export const PACE_MIN_PLAYED = 3600;

const MAX_LEVEL = 60;
const BAR_SEGMENTS = 10;
const MAX_REPUTATIONS = 10;
const MAX_PROFESSIONS = 10;
const SEP = ' · ';

export interface Privacy {
  hideMoney: boolean;
  hideZone: boolean;
  hidePresence: boolean;
}

export interface CharacterNames {
  firstName: string;
  surname: string;
}

/** What /profil reads from `snapshot.detail`; parsed defensively by the query service. */
export interface ProfileDetail {
  guild?: string | null;
  guildRank?: string | null;
  ilvl?: number | null;
  professions: { name: string; rank: number; max: number | null }[];
  reputations: { name: string; standing: number }[];
}

export interface ProfileSnapshot {
  level: number;
  xp: number | null;
  xpMax: number | null;
  /** Copper. */
  money: bigint | null;
  /** Seconds. */
  playedTotal: number | null;
  zone: string | null;
  subZone: string | null;
  receivedAt: Date;
  detail: ProfileDetail;
}

export interface ProfileInput {
  discordUserId: string;
  privacy: Privacy;
  character: CharacterNames & { classFile: string | null; role: 'main' | 'alt' };
  /** Latest snapshot, null when never synchronized. */
  snapshot: ProfileSnapshot | null;
  /** Last level-ups, newest first (at most 10 are shown). */
  levels: { level: number; at: Date }[];
}

export interface SessionInput {
  discordUserId: string;
  privacy: Privacy;
  /** Null until the first sync of the session tells which character is played. */
  character: CharacterNames | null;
  startedAt: Date;
  /** Null for the session in progress. */
  endedAt: Date | null;
  levelStart: number | null;
  levelEnd: number | null;
  moneyStart: bigint | null;
  moneyEnd: bigint | null;
  playedStart: number | null;
  playedEnd: number | null;
  /** Zone of the last snapshot of the session. */
  zone: string | null;
  subZone: string | null;
  /** DEATH events of the period. */
  deaths: number;
}

export type LeaderboardCriterion = 'level' | 'played' | 'pace' | 'money' | 'deaths';

export interface LeaderboardEntry {
  discordUserId: string;
  privacy: Privacy;
  /** The member's main character. */
  character: CharacterNames;
  /** Latest snapshot of the main, null when never synchronized. */
  snapshot: {
    level: number;
    xp: number | null;
    xpMax: number | null;
    playedTotal: number | null;
    money: bigint | null;
    /** Death counter of the addon. */
    deaths: number | null;
  } | null;
}

export interface LeaderboardInput {
  criterion: LeaderboardCriterion;
  /** One entry per member of the guild that has a main character. */
  entries: LeaderboardEntry[];
}

const CLASS_NAMES_FR: Record<string, string> = {
  WARRIOR: 'Guerrier',
  PALADIN: 'Paladin',
  HUNTER: 'Chasseur',
  ROGUE: 'Voleur',
  PRIEST: 'Prêtre',
  SHAMAN: 'Chaman',
  MAGE: 'Mage',
  WARLOCK: 'Démoniste',
  DRUID: 'Druide',
};

const STANDING_NAMES_FR: Record<number, string> = {
  6: 'Honoré',
  7: 'Révéré',
  8: 'Exalté',
};

const CRITERION_NAMES_FR: Record<LeaderboardCriterion, string> = {
  level: 'niveau',
  played: 'temps joué',
  pace: 'rythme',
  money: 'or',
  deaths: 'morts',
};

const MEDALS = ['🥇', '🥈', '🥉'];

// --- Formatting ------------------------------------------------------------

/** Copper as « 38 po 45 pa 12 pc », zero parts left out. */
export function formatMoney(copper: bigint): string {
  const abs = copper < 0n ? -copper : copper;
  const parts: string[] = [];
  const gold = abs / 10000n;
  const silver = (abs / 100n) % 100n;
  const rest = abs % 100n;
  if (gold > 0n) parts.push(`${gold} po`);
  if (silver > 0n) parts.push(`${silver} pa`);
  if (rest > 0n) parts.push(`${rest} pc`);
  return parts.length ? parts.join(' ') : '0 pc';
}

/** A gold change: « +38 po », « -12 pa », « 0 pc ». */
export function formatSignedMoney(copper: bigint): string {
  if (copper === 0n) return '0 pc';
  return `${copper > 0n ? '+' : '-'}${formatMoney(copper)}`;
}

/** « 45 min », « 2 h 05 », « 9 j 4 h ». */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds / 60));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days > 0) return hours > 0 ? `${days} j ${hours} h` : `${days} j`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${String(minutes).padStart(2, '0')}` : `${hours} h`;
  return `${minutes} min`;
}

function fullName(c: CharacterNames): string {
  return `${c.firstName} ${c.surname}`;
}

function place(zone: string | null, subZone: string | null): string | null {
  if (!zone) return subZone || null;
  return subZone && subZone !== zone ? `${subZone}, ${zone}` : zone;
}

function toUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** XP progress within the level, floored so 100 % never shows; null when unknown. */
function xpRatio(xp: number | null, xpMax: number | null): number | null {
  if (xp === null || xpMax === null || xpMax <= 0) return null;
  return Math.max(0, Math.min(0.99, xp / xpMax));
}

function xpBar(ratio: number): string {
  const filled = Math.floor(ratio * BAR_SEGMENTS);
  return '▰'.repeat(filled) + '▱'.repeat(BAR_SEGMENTS - filled);
}

/** « a · b · c · + 4 autres », at most `max` items. */
function capped(items: string[], max: number): string {
  if (items.length <= max) return items.join(SEP);
  return [...items.slice(0, max), `+ ${items.length - max} autres`].join(SEP);
}

// --- /profil ---------------------------------------------------------------

export function renderProfile(input: ProfileInput): string {
  const { character, snapshot, privacy } = input;
  const className = character.classFile ? CLASS_NAMES_FR[character.classFile] : undefined;
  const owner = `${character.role === 'main' ? 'principal' : 'secondaire'} de <@${input.discordUserId}>`;
  const lines = [[`**${fullName(character)}**`, className, owner].filter(Boolean).join(SEP)];

  if (!snapshot) {
    lines.push('Pas encore synchronisé : lance le jeu avec l’appli compagnon ou utilise /sync.');
    return lines.join('\n');
  }

  lines.push(levelLine(snapshot));
  if (snapshot.playedTotal !== null) lines.push(`⏱️ Temps joué : ${formatDuration(snapshot.playedTotal)}`);
  if (!privacy.hideMoney && snapshot.money !== null) lines.push(`💰 Or : ${formatMoney(snapshot.money)}`);
  const where = privacy.hideZone ? null : place(snapshot.zone, snapshot.subZone);
  if (where) lines.push(`📍 Zone : ${where}`);

  const { detail } = snapshot;
  if (detail.guild) lines.push(`🛡️ Guilde : <${detail.guild}>${detail.guildRank ? `${SEP}${detail.guildRank}` : ''}`);
  if (typeof detail.ilvl === 'number') lines.push(`⚔️ Équipement : ilvl ${Math.floor(detail.ilvl)}`);
  if (detail.professions.length) {
    const professions = detail.professions.map((p) => `${p.name} ${p.rank}${p.max !== null ? `/${p.max}` : ''}`);
    lines.push(`🛠️ Métiers : ${capped(professions, MAX_PROFESSIONS)}`);
  }
  const reputations = detail.reputations
    .filter((r) => r.standing >= MIN_SHOWN_STANDING)
    .sort((a, b) => b.standing - a.standing || a.name.localeCompare(b.name, 'fr'))
    .map((r) => `${r.name} (${STANDING_NAMES_FR[Math.min(r.standing, 8)]})`);
  if (reputations.length) lines.push(`🤝 Réputations : ${capped(reputations, MAX_REPUTATIONS)}`);

  if (input.levels.length) {
    lines.push('📈 Derniers niveaux :');
    for (const l of input.levels.slice(0, 10)) lines.push(`• niv. ${l.level} — <t:${toUnix(l.at)}:d>`);
  }
  if (!privacy.hidePresence) lines.push(`Synchro <t:${toUnix(snapshot.receivedAt)}:R>`);
  return fit(lines);
}

function levelLine(snapshot: ProfileSnapshot): string {
  if (snapshot.level >= MAX_LEVEL) return `Niveau ${snapshot.level}`;
  const ratio = xpRatio(snapshot.xp, snapshot.xpMax);
  if (ratio === null) return `Niveau ${snapshot.level}`;
  const percent = Math.floor(ratio * 100);
  return `Niveau ${snapshot.level}${SEP}${xpBar(ratio)} ${percent} % (${snapshot.xp} / ${snapshot.xpMax} XP)`;
}

/** Truncates the longest lines until the message fits Discord's limit (only absurd inputs get there). */
function fit(lines: string[]): string {
  let text = lines.join('\n');
  while (text.length > MAX_REPLY_CHARS) {
    const longest = lines.reduce((best, line, i) => (line.length > lines[best].length ? i : best), 0);
    const excess = text.length - MAX_REPLY_CHARS;
    lines[longest] = `${lines[longest].slice(0, Math.max(0, lines[longest].length - excess - 1))}…`;
    text = lines.join('\n');
  }
  return text;
}

// --- /session --------------------------------------------------------------

export function renderSession(input: SessionInput, now: Date): string {
  const { privacy } = input;
  const live = input.endedAt === null;
  const who = input.character ? fullName(input.character) : 'perso inconnu';
  const lines = [
    live
      ? `🟢 **Session en cours** de <@${input.discordUserId}> — ${who}`
      : `⚫ **Dernière session** de <@${input.discordUserId}> — ${who}`,
  ];

  const end = input.endedAt ?? now;
  const duration = formatDuration((end.getTime() - input.startedAt.getTime()) / 1000);
  if (live) lines.push(`⏱️ Depuis <t:${toUnix(input.startedAt)}:R> (${duration})`);
  else if (privacy.hidePresence) lines.push(`⏱️ Durée : ${duration}`);
  else lines.push(`⏱️ Durée : ${duration}${SEP}terminée <t:${toUnix(end)}:R>`);

  const { levelStart, levelEnd } = input;
  if (levelStart !== null && levelEnd !== null && levelEnd !== levelStart) {
    lines.push(`⬆️ Niveaux : ${levelStart} → ${levelEnd} (+${levelEnd - levelStart})`);
  } else if (levelEnd !== null || levelStart !== null) {
    lines.push(`⬆️ Niveau : ${levelEnd ?? levelStart}`);
  }
  if (!privacy.hideMoney && input.moneyStart !== null && input.moneyEnd !== null) {
    lines.push(`💰 Or : ${formatSignedMoney(input.moneyEnd - input.moneyStart)}`);
  }
  if (input.playedStart !== null && input.playedEnd !== null) {
    lines.push(`🎮 Temps de jeu ajouté : ${formatDuration(input.playedEnd - input.playedStart)}`);
  }
  const where = privacy.hideZone ? null : place(input.zone, input.subZone);
  if (where) lines.push(live ? `📍 Zone actuelle : ${where}` : `📍 Fin à ${where}`);
  lines.push(`💀 Morts : ${input.deaths}`);
  return lines.join('\n');
}

// --- /classement -----------------------------------------------------------

interface Ranked {
  entry: LeaderboardEntry;
  value: number;
  /** Tie-break, higher first. */
  tie: number;
  text: string;
}

export function renderLeaderboard(input: LeaderboardInput): string {
  const title = `🏆 **Classement — ${CRITERION_NAMES_FR[input.criterion]}**`;
  const ranked = input.entries
    .map((entry) => rank(entry, input.criterion))
    .filter((r): r is Ranked => r !== null)
    .sort(
      (a, b) =>
        b.value - a.value ||
        b.tie - a.tie ||
        fullName(a.entry.character).localeCompare(fullName(b.entry.character), 'fr') ||
        (a.entry.discordUserId < b.entry.discordUserId ? -1 : 1),
    )
    .slice(0, LEADERBOARD_SIZE);
  if (!ranked.length) return `${title}\nPersonne n’est encore classé sur ce critère.`;

  const lines = ranked.map((r, i) => {
    const position = MEDALS[i] ?? `${i + 1}.`;
    return `${position} ${fullName(r.entry.character)}${SEP}<@${r.entry.discordUserId}> — ${r.text}`;
  });
  return [title, ...lines].join('\n');
}

/** The entry's score for the criterion, or null when it is not ranked there. */
function rank(entry: LeaderboardEntry, criterion: LeaderboardCriterion): Ranked | null {
  const s = entry.snapshot;
  if (!s) return null;
  switch (criterion) {
    case 'level':
      return { entry, value: s.level, tie: xpRatio(s.xp, s.xpMax) ?? -1, text: `niv. ${s.level}` };
    case 'played':
      if (s.playedTotal === null) return null;
      return { entry, value: s.playedTotal, tie: 0, text: formatDuration(s.playedTotal) };
    case 'pace': {
      if (s.playedTotal === null || s.playedTotal < PACE_MIN_PLAYED) return null;
      // Levels gained since level 1, per played hour.
      const pace = (s.level - 1) / (s.playedTotal / 3600);
      return { entry, value: pace, tie: s.level, text: `${pace.toFixed(2).replace('.', ',')} niv./h` };
    }
    case 'money':
      if (entry.privacy.hideMoney || s.money === null) return null;
      return { entry, value: Number(s.money), tie: 0, text: formatMoney(s.money) };
    case 'deaths':
      if (s.deaths === null) return null;
      return { entry, value: s.deaths, tie: 0, text: `${s.deaths} ${s.deaths > 1 ? 'morts' : 'mort'}` };
  }
}
