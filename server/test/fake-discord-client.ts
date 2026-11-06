import { EventEmitter } from 'node:events';

export interface RestCall {
  method: 'patch' | 'post' | 'delete';
  route: string;
  body?: unknown;
}

/** Records REST calls (webhook edits, DMs, channel and board messages) instead of sending them to Discord. */
export class FakeRest {
  calls: RestCall[] = [];
  /** When set, editing an interaction reply fails like an expired interaction token (50027). */
  failWebhookEdits = false;
  private nextMessageId = 1;

  reset(): void {
    this.calls = [];
    this.failWebhookEdits = false;
  }

  patch(route: string, options: { body?: unknown } = {}): Promise<unknown> {
    this.calls.push({ method: 'patch', route, body: options.body });
    if (this.failWebhookEdits && route.startsWith('/webhooks/')) {
      return Promise.reject(Object.assign(new Error('Invalid Webhook Token'), { code: 50027, status: 401 }));
    }
    return Promise.resolve({});
  }

  post(route: string, options: { body?: unknown } = {}): Promise<unknown> {
    this.calls.push({ method: 'post', route, body: options.body });
    if (route === '/users/@me/channels') {
      return Promise.resolve({ id: `dm-${(options.body as { recipient_id: string }).recipient_id}` });
    }
    return Promise.resolve({ id: `fake-message-${this.nextMessageId++}` });
  }

  delete(route: string): Promise<unknown> {
    this.calls.push({ method: 'delete', route });
    return Promise.resolve(undefined);
  }
}

/** Stands in for the discord.js client in e2e runs: no gateway connection, always "ready". */
export class FakeDiscordClient extends EventEmitter {
  readonly application = { commands: { set: () => Promise.resolve(new Map()) } };
  readonly rest = new FakeRest();
  login(): Promise<string> {
    return Promise.resolve('fake');
  }
  isReady(): boolean {
    return true;
  }
  destroy(): Promise<void> {
    return Promise.resolve();
  }
}
