import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import type { BoardRest } from '../board-ports';

export interface RestCall {
  method: 'post' | 'patch' | 'delete';
  route: string;
  body?: unknown;
}

interface Failure {
  method: RestCall['method'];
  /** Exact route, or undefined for any route. */
  route?: string;
  code: number;
  status: number;
}

/**
 * In-memory Discord REST API for channel messages: keeps each channel's messages in order,
 * records every call, and can fail a call with a real `DiscordAPIError`.
 */
export class FakeBoardRest implements BoardRest {
  calls: RestCall[] = [];
  /** channel id → message id → body, in creation order. */
  readonly channels = new Map<string, Map<string, unknown>>();
  private nextId = 1000;
  private failures: Failure[] = [];

  /** The next matching call fails with this Discord error code (once). */
  failNext(method: RestCall['method'], code: RESTJSONErrorCodes, route?: string): void {
    const status = code === RESTJSONErrorCodes.MissingPermissions ? 403 : 404;
    this.failures.push({ method, route, code, status });
  }

  /** Simulates a message deleted by hand in Discord. */
  deleteByHand(channelId: string, messageId: string): void {
    this.channels.get(channelId)?.delete(messageId);
  }

  messagesOf(channelId: string): { id: string; body: unknown }[] {
    return [...(this.channels.get(channelId) ?? new Map<string, unknown>()).entries()].map(([id, body]) => ({ id, body }));
  }

  reset(): void {
    this.calls = [];
  }

  post(route: `/${string}`, options: { body: unknown }): Promise<unknown> {
    this.calls.push({ method: 'post', route, body: options.body });
    this.maybeFail('post', route);
    const channelId = this.channelOf(route, /^\/channels\/([^/]+)\/messages$/);
    const id = String(this.nextId++);
    this.channel(channelId).set(id, options.body);
    return Promise.resolve({ id, channel_id: channelId });
  }

  patch(route: `/${string}`, options: { body: unknown }): Promise<unknown> {
    this.calls.push({ method: 'patch', route, body: options.body });
    this.maybeFail('patch', route);
    const [channelId, messageId] = this.messageOf(route);
    const messages = this.channel(channelId);
    if (!messages.has(messageId)) this.throwApi('patch', route, RESTJSONErrorCodes.UnknownMessage, 404);
    messages.set(messageId, options.body);
    return Promise.resolve({ id: messageId });
  }

  delete(route: `/${string}`): Promise<unknown> {
    this.calls.push({ method: 'delete', route });
    this.maybeFail('delete', route);
    const [channelId, messageId] = this.messageOf(route);
    const messages = this.channel(channelId);
    if (!messages.has(messageId)) this.throwApi('delete', route, RESTJSONErrorCodes.UnknownMessage, 404);
    messages.delete(messageId);
    return Promise.resolve(undefined);
  }

  private channel(channelId: string): Map<string, unknown> {
    let messages = this.channels.get(channelId);
    if (!messages) {
      messages = new Map();
      this.channels.set(channelId, messages);
    }
    return messages;
  }

  private channelOf(route: string, pattern: RegExp): string {
    const match = pattern.exec(route);
    if (!match) throw new Error(`FakeBoardRest: unexpected route ${route}`);
    return match[1];
  }

  private messageOf(route: string): [string, string] {
    const match = /^\/channels\/([^/]+)\/messages\/([^/]+)$/.exec(route);
    if (!match) throw new Error(`FakeBoardRest: unexpected route ${route}`);
    return [match[1], match[2]];
  }

  private maybeFail(method: RestCall['method'], route: string): void {
    const index = this.failures.findIndex((f) => f.method === method && (f.route === undefined || f.route === route));
    if (index < 0) return;
    const [failure] = this.failures.splice(index, 1);
    this.throwApi(method, route, failure.code, failure.status);
  }

  private throwApi(method: string, route: string, code: number, status: number): never {
    throw new DiscordAPIError({ code, message: `Fake error ${code}` }, code, status, method.toUpperCase(), `https://discord.com/api/v10${route}`, {});
  }
}
