import { Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { Events, type Client } from 'discord.js';
import { EventEmitter } from 'node:events';
import type { AppConfig } from '../../common/config/config';
import { HealthRegistry } from '../../common/health/health.registry';
import { COMMAND_DEFINITIONS } from '../registry/command-definitions';
import { CommandRegistry } from '../registry/command-registry';
import { DiscordClientService } from './discord-client.service';

class FakeClient extends EventEmitter {
  ready = false;
  readonly application = { commands: { set: jest.fn().mockResolvedValue(new Map()) } };
  login = jest.fn().mockResolvedValue('ok');
  destroy = jest.fn().mockResolvedValue(undefined);
  isReady() {
    return this.ready;
  }
  becomeReady() {
    this.ready = true;
    this.emit(Events.ClientReady, this);
  }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function build(devGuildId?: string) {
  const client = new FakeClient();
  const registry = new CommandRegistry([]);
  jest.spyOn(registry, 'handle').mockResolvedValue(undefined);
  const health = new HealthRegistry();
  const moduleRef = { get: jest.fn(() => 'provider') } as unknown as ModuleRef;
  const config = { discordToken: 'secret-token', discordDevGuildId: devGuildId } as AppConfig;
  const service = new DiscordClientService(client as unknown as Client, config, registry, moduleRef, health);
  return { client, registry, health, moduleRef, service };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('DiscordClientService', () => {
  it('logs in with the token when the service starts', async () => {
    const { client, service } = build();

    await service.onApplicationBootstrap();

    expect(client.login).toHaveBeenCalledWith('secret-token');
  });

  it('registers every command on the dev guild when DISCORD_DEV_GUILD_ID is set', async () => {
    const { client, service } = build('400000000000000001');
    await service.onApplicationBootstrap();

    client.becomeReady();
    await flush();

    expect(client.application.commands.set).toHaveBeenCalledWith(COMMAND_DEFINITIONS, '400000000000000001');
  });

  it('registers every command globally otherwise', async () => {
    const { client, service } = build();
    await service.onApplicationBootstrap();

    client.becomeReady();
    await flush();

    expect(client.application.commands.set).toHaveBeenCalledWith(COMMAND_DEFINITIONS);
  });

  it('keeps running when the registration fails', async () => {
    const { client, service } = build();
    client.application.commands.set.mockRejectedValue(new Error('rate limited'));
    await service.onApplicationBootstrap();

    client.becomeReady();
    await flush();

    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('rate limited'));
  });

  it('forwards interactions to the registry with a context backed by Nest', async () => {
    const { client, registry, moduleRef, service } = build();
    await service.onApplicationBootstrap();
    const interaction = { id: 'i1' };

    client.emit(Events.InteractionCreate, interaction);
    await flush();

    expect(registry.handle).toHaveBeenCalledWith(interaction, expect.anything());
    const calls = (registry.handle as jest.Mock<Promise<void>, [unknown, { get(t: unknown): unknown }]>).mock.calls;
    const ctx = calls[0][1];
    expect(ctx.get('TOKEN')).toBe('provider');
    expect(moduleRef.get).toHaveBeenCalledWith('TOKEN', { strict: false });
  });

  it('reports the gateway connection in /health', async () => {
    const { client, health, service } = build();
    await service.onApplicationBootstrap();
    await expect(health.run()).resolves.toEqual({ discord: false });

    client.becomeReady();

    await expect(health.run()).resolves.toEqual({ discord: true });
  });

  it('closes the gateway connection on shutdown', async () => {
    const { client, service } = build();

    await service.onModuleDestroy();

    expect(client.destroy).toHaveBeenCalled();
  });
});
