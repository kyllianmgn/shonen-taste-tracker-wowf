/**
 * Pure rendering of the board channel (docs/02 « Salon tableau et salon logs » → Tableau).
 *
 * No Discord client, no database: callers map their data into the input types below and send
 * the returned payloads as-is (one payload per board message, in order).
 */

/** Discord message flag that switches a message to Components V2. */
export const IS_COMPONENTS_V2 = 1 << 15;
export const COMPONENT_TYPE_CONTAINER = 17;
export const COMPONENT_TYPE_TEXT_DISPLAY = 10;

/** Our text budget per message (Discord allows 4 000; docs/02 keeps a margin). */
export const BOARD_MAX_TEXT_CHARS = 3800;
/** Discord limit of components per message, nested ones included. */
export const BOARD_MAX_COMPONENTS = 40;

const MAX_LEVEL = 60;
const BAR_SEGMENTS = 10;
const BAR_FULL = '▰';
const BAR_EMPTY = '▱';
const INDENT = '   ';
const SEP = ' · ';

export type BoardSort = 'level' | 'played' | 'name';

export interface BoardSnapshot {
  level: number;
  xp: number | null;
  xpMax: number | null;
  /** Seconds. */
  playedTotal: number | null;
  zone: string | null;
}

export interface BoardCharacter {
  firstName: string;
  surname: string;
  /** Non-localized class token (WARRIOR, PRIEST…), null if unknown. */
  classFile: string | null;
  /** Latest snapshot, null if the character was never synchronized. */
  snapshot: BoardSnapshot | null;
}

/** `base`: no active device, data from Battle.net or /sync only (docs/02 « Affichage en mode de base »). */
export type BoardPlayerMode = 'app' | 'base';

export interface BoardPlayer {
  discordUserId: string;
  mode: BoardPlayerMode;
  privacy: { hideZone: boolean; hidePresence: boolean };
  /**
   * App mode: heartbeat presence. Base mode: `online` is ignored and `lastSeenAt` is the last
   * `last_login_timestamp` or the last data received.
   */
  presence: { online: boolean; lastSeenAt: Date | null };
  main: BoardCharacter | null;
  alt: BoardCharacter | null;
}

export interface BoardInput {
  guild: { boardSort: BoardSort };
  /** Players with a membership on this guild. */
  players: BoardPlayer[];
  now: Date;
}

export interface TextDisplayComponent {
  type: typeof COMPONENT_TYPE_TEXT_DISPLAY;
  content: string;
}

export interface ContainerComponent {
  type: typeof COMPONENT_TYPE_CONTAINER;
  components: TextDisplayComponent[];
}

export interface BoardMessagePayload {
  flags: number;
  components: ContainerComponent[];
  allowed_mentions: { parse: [] };
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

export function renderBoard(input: BoardInput): BoardMessagePayload[] {
  const players = sortPlayers(input.players, input.guild.boardSort);
  const header = renderHeader(input.players);
  const footer = `Mis à jour <t:${toUnix(input.now)}:R>`;
  const blocks = players.map(renderPlayer);
  return paginate(header, blocks, footer).map(toPayload);
}

function isShownOnline(player: BoardPlayer): boolean {
  return player.mode === 'app' && player.presence.online && !player.privacy.hidePresence;
}

function renderHeader(players: BoardPlayer[]): string {
  const total = players.length;
  const online = players.filter(isShownOnline).length;
  const tracked = total > 1 ? `${total} joueurs suivis` : `${total} joueur suivi`;
  return `WoW: Forever — ${tracked}${SEP}${online} en ligne`;
}

function renderPlayer(player: BoardPlayer): string {
  const lines = [renderPlayerTitle(player)];
  if (!player.main && !player.alt) {
    lines.push(`${INDENT}aucun perso suivi`);
  }
  if (player.main) {
    lines.push(INDENT + renderCharacter(player.main, !player.privacy.hideZone));
  }
  if (player.alt) {
    // An alt shows no zone: it is usually stale and the main line already carries it.
    lines.push(`${INDENT}↳ ${player.alt.snapshot ? renderCharacter(player.alt, false) : 'non synchronisé'}`);
  }
  return lines.join('\n');
}

function renderPlayerTitle(player: BoardPlayer): string {
  const mention = `<@${player.discordUserId}>`;
  if (player.mode === 'base') return renderBaseModeTitle(player, mention);
  if (player.privacy.hidePresence) return mention;
  if (player.presence.online) return `🟢 ${mention}`;
  const seen = player.presence.lastSeenAt;
  return seen ? `⚫ ${mention}${SEP}vu <t:${toUnix(seen)}:R>` : `⚫ ${mention}`;
}

/** No dot in base mode: presence is unknown, only the age of the last data is. */
function renderBaseModeTitle(player: BoardPlayer, mention: string): string {
  const seen = player.privacy.hidePresence ? null : player.presence.lastSeenAt;
  const parts = [mention];
  if (seen) parts.push(`vu <t:${toUnix(seen)}:R>`);
  parts.push('*mode de base*');
  return parts.join(SEP);
}

function renderCharacter(character: BoardCharacter, showZone: boolean): string {
  const name = `${character.firstName} ${character.surname}`;
  const snapshot = character.snapshot;
  if (!snapshot) return `${name}${SEP}non synchronisé`;

  const className = character.classFile ? CLASS_NAMES_FR[character.classFile] : undefined;
  const parts = [name, className ? `${className} ${snapshot.level}` : `niv. ${snapshot.level}`];
  if (snapshot.level < MAX_LEVEL) {
    const percent = xpPercent(snapshot);
    parts.push(percent === null ? levelBar(snapshot.level) : `${levelBar(snapshot.level)} ${percent} %`);
  }
  if (showZone && snapshot.zone) parts.push(snapshot.zone);
  return parts.join(SEP);
}

/** 10 segments for level / 60; never full before 60 so a full bar always means 60. */
function levelBar(level: number): string {
  const filled = Math.max(0, Math.min(BAR_SEGMENTS - 1, Math.round((level / MAX_LEVEL) * BAR_SEGMENTS)));
  return BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(BAR_SEGMENTS - filled);
}

/** XP progress within the current level, floored so 100 % never shows. */
function xpPercent(snapshot: BoardSnapshot): number | null {
  if (snapshot.xp === null || snapshot.xpMax === null || snapshot.xpMax <= 0) return null;
  return Math.max(0, Math.min(99, Math.floor((snapshot.xp / snapshot.xpMax) * 100)));
}

function sortPlayers(players: BoardPlayer[], sort: BoardSort): BoardPlayer[] {
  const byOnline = (a: BoardPlayer, b: BoardPlayer) => Number(isShownOnline(b)) - Number(isShownOnline(a));
  const byLevel = (a: BoardPlayer, b: BoardPlayer) => compareDesc(mainLevel(a), mainLevel(b));
  const byPlayed = (a: BoardPlayer, b: BoardPlayer) => compareDesc(mainPlayed(a), mainPlayed(b));
  const byName = (a: BoardPlayer, b: BoardPlayer) => compareName(mainName(a), mainName(b));
  const byId = (a: BoardPlayer, b: BoardPlayer) => compareStrings(a.discordUserId, b.discordUserId);
  const order = {
    level: [byLevel, byPlayed, byName],
    played: [byPlayed, byLevel, byName],
    name: [byName, byLevel],
  }[sort];
  const comparators = [byOnline, ...order, byId];
  return [...players].sort((a, b) => {
    for (const compare of comparators) {
      const result = compare(a, b);
      if (result !== 0) return result;
    }
    return 0;
  });
}

function mainLevel(player: BoardPlayer): number | null {
  return player.main?.snapshot?.level ?? null;
}

function mainPlayed(player: BoardPlayer): number | null {
  return player.main?.snapshot?.playedTotal ?? null;
}

function mainName(player: BoardPlayer): string | null {
  return player.main ? `${player.main.firstName} ${player.main.surname}` : null;
}

/** Higher first, unknown last. */
function compareDesc(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/** Alphabetical (French collation), unknown last. */
function compareName(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b, 'fr', { sensitivity: 'base' });
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Text cost of a display: its content plus one separator, a conservative bound. */
function cost(text: string): number {
  return text.length + 1;
}

/**
 * Packs blocks into pages of at most BOARD_MAX_TEXT_CHARS and BOARD_MAX_COMPONENTS (container
 * included). The header opens the first page; every page reserves room for the footer, which
 * closes the last one. A player block is never split.
 */
function paginate(header: string, blocks: string[], footer: string): string[][] {
  const maxDisplays = BOARD_MAX_COMPONENTS - 1; // minus the container
  const pages: string[][] = [];
  let page: string[] = [header];
  let used = cost(header);
  const reserved = cost(footer);

  for (const block of blocks) {
    const fits = page.length + 2 <= maxDisplays && used + cost(block) + reserved <= BOARD_MAX_TEXT_CHARS;
    if (!fits && page.length > 0) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(block);
    used += cost(block);
  }
  page.push(footer);
  pages.push(page);
  return pages;
}

function toPayload(displays: string[]): BoardMessagePayload {
  return {
    flags: IS_COMPONENTS_V2,
    components: [
      {
        type: COMPONENT_TYPE_CONTAINER,
        components: displays.map((content) => ({ type: COMPONENT_TYPE_TEXT_DISPLAY, content })),
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

function toUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
