import { escapeMarkdown } from 'discord.js';
import type { TrackedRole } from '../../core/characters/character.types';
import type { SessionRecap } from '../../presence/session-recap';
import { formatDuration, formatSignedMoney } from './profile';

/**
 * Logs channel messages (docs/02 « Salon tableau et salon logs » → Logs), one pure function per
 * row of the table. Each returns one line; the publisher groups a player's lines in one message.
 * Texts coming from the game (names, zones, guilds) are escaped: a sync can carry anything.
 */

/** Discord's limit for a message's content. */
export const LOG_MAX_MESSAGE_CHARS = 2000;

const SEP = ' · ';

export interface LogCharacter {
  firstName: string;
  surname: string;
}

export interface LogPrivacy {
  hideMoney: boolean;
  hideZone: boolean;
  hidePresence: boolean;
}

const ROLE_LABELS: Record<TrackedRole, string> = { main: 'principal', alt: 'secondaire' };

/** Game text: no markdown, no mention, no line break. */
function plain(text: string): string {
  return escapeMarkdown(text.replace(/[\r\n]+/g, ' '))
    .replace(/</g, '\\<')
    .replace(/@/g, '@​');
}

const name = (c: LogCharacter) => plain(`${c.firstName} ${c.surname}`);
const mention = (discordUserId: string) => `<@${discordUserId}>`;

/** Played time of a level-up: « 81 h », « 10 min » under one hour. */
function playedHours(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  return hours > 0 ? `${hours} h` : formatDuration(seconds);
}

export function renderSessionStartLog(input: {
  discordUserId: string;
  character: LogCharacter | null;
  level: number | null;
}): string {
  const line = `🟢 ${mention(input.discordUserId)} est en jeu`;
  if (!input.character) return line;
  const level = input.level === null ? '' : ` (niv. ${input.level})`;
  return `${line} — ${name(input.character)}${level}`;
}

/**
 * « ⚫ Davina Asaria : 2 h 14 de jeu · niv. 21 → 23 · +38 po · fin à Darkshire · 1 mort ».
 * hide_presence drops the duration (the session itself stays, as in /session), hide_money the gold,
 * hide_zone the end zone. The caller skips quiet sessions.
 */
export function renderSessionEndLog(input: {
  discordUserId: string;
  character: LogCharacter | null;
  recap: SessionRecap;
  privacy: LogPrivacy;
}): string {
  const { recap, privacy } = input;
  const parts: string[] = [];
  if (!privacy.hidePresence) parts.push(`${formatDuration(recap.durationSec)} de jeu`);
  const levels = levelPart(recap);
  if (levels) parts.push(levels);
  if (!privacy.hideMoney && recap.moneyDelta !== null && recap.moneyDelta !== 0) {
    parts.push(formatSignedMoney(BigInt(recap.moneyDelta)));
  }
  const zone = privacy.hideZone ? null : recap.endSubZone || recap.endZone;
  if (zone) parts.push(`fin à ${plain(zone)}`);
  if (recap.deaths > 0) parts.push(`${recap.deaths} mort${recap.deaths > 1 ? 's' : ''}`);

  const who = input.character ? name(input.character) : mention(input.discordUserId);
  return `⚫ ${who} : ${parts.length ? parts.join(SEP) : 'session terminée'}`;
}

/**
 * Base mode (docs/02 « Affichage en mode de base »): a session end deduced from Battle.net's
 * last_login_timestamp (S-20) only knows the levels: « ⚫ Davina Asaria : niv. 21 → 23 ».
 */
export function renderBaseModeSessionEndLog(input: {
  discordUserId: string;
  character: LogCharacter | null;
  recap: SessionRecap;
}): string {
  const who = input.character ? name(input.character) : mention(input.discordUserId);
  return `⚫ ${who} : ${levelPart(input.recap) ?? 'session terminée'}`;
}

/** « niv. 21 → 23 », « niv. 23 » when unchanged, null when unknown. */
function levelPart(recap: SessionRecap): string | null {
  if (recap.levelStart !== null && recap.levelEnd !== null && recap.levelStart !== recap.levelEnd) {
    return `niv. ${recap.levelStart} → ${recap.levelEnd}`;
  }
  const level = recap.levelEnd ?? recap.levelStart;
  return level === null ? null : `niv. ${level}`;
}

export function renderLevelUpLog(input: { character: LogCharacter; level: number; playedTotal: number | null }): string {
  const played = input.playedTotal === null ? '' : ` (${playedHours(input.playedTotal)} de jeu)`;
  return `⬆️ ${name(input.character)} passe niveau ${input.level}${played}`;
}

export function renderLevel60Log(input: { character: LogCharacter; playedTotal: number | null }): string {
  const played = input.playedTotal === null ? '' : ` en ${formatDuration(input.playedTotal)} de jeu`;
  return `🏆 ${name(input.character)} atteint le niveau 60${played}`;
}

export function renderTrackedLog(input: { discordUserId: string; character: LogCharacter; role: TrackedRole }): string {
  return `➕ ${mention(input.discordUserId)} suit ${name(input.character)} (${ROLE_LABELS[input.role]})`;
}

/** `female` comes from the last snapshot's `sex` (3); the masculine form is the default. */
export function renderDeathLog(input: {
  character: LogCharacter;
  female: boolean;
  level: number | null;
  zone: string | null;
  hideZone: boolean;
}): string {
  const where = input.zone && !input.hideZone ? ` à ${plain(input.zone)}` : '';
  const level = input.level === null ? '' : ` (niv. ${input.level})`;
  return `💀 ${name(input.character)} est mort${input.female ? 'e' : ''}${where}${level}`;
}

/** « 🏰 Davina Asaria entre dans Les Mortemines ». The caller skips it under hide_zone. */
export function renderDungeonEnterLog(input: { character: LogCharacter; instance: string }): string {
  return `🏰 ${name(input.character)} entre dans ${plain(input.instance)}`;
}

/** The brackets are escaped so `<#123>`-like guild names never render as mentions. */
export function renderGuildJoinLog(input: { character: LogCharacter; guild: string }): string {
  return `${name(input.character)} rejoint \\<${plain(input.guild)}>`;
}

/** The lines of a group, one per line, in as few messages as Discord's limit allows. */
export function splitLogMessages(lines: readonly string[]): string[] {
  const messages: string[] = [];
  let current = '';
  for (const raw of lines) {
    const line = raw.slice(0, LOG_MAX_MESSAGE_CHARS);
    if (current && current.length + 1 + line.length > LOG_MAX_MESSAGE_CHARS) {
      messages.push(current);
      current = '';
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) messages.push(current);
  return messages;
}
