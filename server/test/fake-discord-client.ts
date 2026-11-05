import { EventEmitter } from 'node:events';

/** Stands in for the discord.js client in e2e runs: no gateway connection, always "ready". */
export class FakeDiscordClient extends EventEmitter {
  readonly application = { commands: { set: () => Promise.resolve(new Map()) } };
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
