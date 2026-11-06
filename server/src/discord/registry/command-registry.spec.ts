import { Logger } from '@nestjs/common';
import { MessageFlags, type Interaction } from 'discord.js';
import { MSG } from '../messages';
import type { CommandContext, CommandHandler } from './command-handler';
import { COMMANDS_DIR, CommandRegistry, isHandlerFile, loadCommandHandlers, loadComponentHandlers } from './command-registry';

const ctx: CommandContext = { get: () => undefined as never };

/** Minimal chat-input interaction double; only what the registry touches. */
function chatInput(commandName: string, sub: string | null = null, group: string | null = null) {
  const state = { deferred: false, replied: false };
  return {
    ...state,
    commandName,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    options: { getSubcommand: () => sub, getSubcommandGroup: () => group },
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  };
}

function autocomplete(commandName: string, sub: string | null = null) {
  return {
    commandName,
    isChatInputCommand: () => false,
    isAutocomplete: () => true,
    options: { getSubcommand: () => sub, getSubcommandGroup: () => null },
    respond: jest.fn().mockResolvedValue(undefined),
  };
}

const asInteraction = (fake: object) => fake as unknown as Interaction;

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('isHandlerFile', () => {
  it.each([
    ['setup.ts', true],
    ['setup.js', true],
    ['perso-ajouter.ts', true],
    ['setup.spec.ts', false],
    ['setup.spec.js', false],
    ['setup.d.ts', false],
    ['setup.js.map', false],
    ['README.md', false],
  ])('%s → %s', (name, expected) => {
    expect(isHandlerFile(name)).toBe(expected);
  });
});

describe('loadCommandHandlers', () => {
  it('discovers the handlers of commands/ on its own, /setup included', () => {
    const handlers = loadCommandHandlers(COMMANDS_DIR);
    expect(handlers.map((h) => h.key)).toContain('setup');
  });

  it('builds a valid registry from the real commands/ directory', () => {
    expect(() => new CommandRegistry(loadCommandHandlers(COMMANDS_DIR))).not.toThrow();
  });
});

describe('CommandRegistry', () => {
  it('rejects a handler whose key matches no declared command', () => {
    expect(() => new CommandRegistry([{ key: 'nope', execute: jest.fn() }])).toThrow(/nope/);
  });

  it('rejects two handlers for the same command', () => {
    const h: CommandHandler = { key: 'setup', execute: jest.fn() };
    expect(() => new CommandRegistry([h, { ...h }])).toThrow(/setup/);
  });

  it('lists the commands that have no handler yet', () => {
    const registry = new CommandRegistry([{ key: 'setup', execute: jest.fn() }]);
    expect(registry.pendingKeys()).toContain('perso ajouter');
    expect(registry.pendingKeys()).not.toContain('setup');
  });

  it('routes a command to its handler by name, subcommand and group', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const registry = new CommandRegistry([{ key: 'perso ajouter', execute }]);
    const interaction = chatInput('perso', 'ajouter');

    await registry.handle(asInteraction(interaction), ctx);

    expect(execute).toHaveBeenCalledWith(interaction, ctx);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('answers « Bientôt disponible » ephemerally for a declared command without handler', async () => {
    const registry = new CommandRegistry([]);
    const interaction = chatInput('lier', 'appli');

    await registry.handle(asInteraction(interaction), ctx);

    expect(interaction.reply).toHaveBeenCalledWith({ content: MSG.comingSoon, flags: MessageFlags.Ephemeral });
  });

  it('answers a generic ephemeral error when a handler throws before replying', async () => {
    const registry = new CommandRegistry([{ key: 'setup', execute: jest.fn().mockRejectedValue(new Error('boom')) }]);
    const interaction = chatInput('setup');

    await registry.handle(asInteraction(interaction), ctx);

    expect(interaction.reply).toHaveBeenCalledWith({ content: MSG.genericError, flags: MessageFlags.Ephemeral });
  });

  it('edits the deferred reply when a handler throws after deferring', async () => {
    const interaction = chatInput('setup');
    const registry = new CommandRegistry([
      {
        key: 'setup',
        execute: () => {
          interaction.deferred = true;
          return Promise.reject(new Error('boom'));
        },
      },
    ]);

    await registry.handle(asInteraction(interaction), ctx);

    expect(interaction.editReply).toHaveBeenCalledWith({ content: MSG.genericError });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('never lets a failing error reply escape', async () => {
    const registry = new CommandRegistry([{ key: 'setup', execute: jest.fn().mockRejectedValue(new Error('boom')) }]);
    const interaction = chatInput('setup');
    interaction.reply.mockRejectedValue(new Error('interaction expired'));

    await expect(registry.handle(asInteraction(interaction), ctx)).resolves.toBeUndefined();
  });

  it('routes autocomplete to the handler, or answers no choice', async () => {
    const complete = jest.fn().mockResolvedValue(undefined);
    const registry = new CommandRegistry([{ key: 'perso principal', execute: jest.fn(), autocomplete: complete }]);

    const handled = autocomplete('perso', 'principal');
    await registry.handle(asInteraction(handled), ctx);
    expect(complete).toHaveBeenCalledWith(handled, ctx);

    const unhandled = autocomplete('perso', 'retirer');
    await registry.handle(asInteraction(unhandled), ctx);
    expect(unhandled.respond).toHaveBeenCalledWith([]);
  });

  it('ignores other interactions', async () => {
    const registry = new CommandRegistry([]);
    const other = { isChatInputCommand: () => false, isAutocomplete: () => false, isMessageComponent: () => false };

    await expect(registry.handle(asInteraction(other), ctx)).resolves.toBeUndefined();
  });
});

describe('CommandRegistry message components', () => {
  function component(customId: string) {
    return {
      customId,
      deferred: false,
      replied: false,
      isChatInputCommand: () => false,
      isAutocomplete: () => false,
      isMessageComponent: () => true,
      reply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined),
    };
  }

  it('routes a component to its handler by custom id', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const registry = new CommandRegistry([], undefined, [{ customId: 'bnet-link:main', execute }]);
    const interaction = component('bnet-link:main');

    await registry.handle(asInteraction(interaction), ctx);

    expect(execute).toHaveBeenCalledWith(interaction, ctx);
  });

  it('answers ephemerally that the menu is no longer available for an unknown custom id', async () => {
    const registry = new CommandRegistry([]);
    const interaction = component('old:menu');

    await registry.handle(asInteraction(interaction), ctx);

    expect(interaction.reply).toHaveBeenCalledWith({ content: MSG.componentExpired, flags: MessageFlags.Ephemeral });
  });

  it('answers a generic ephemeral error when a component handler throws', async () => {
    const registry = new CommandRegistry([], undefined, [
      { customId: 'x', execute: jest.fn().mockRejectedValue(new Error('boom')) },
    ]);
    const interaction = component('x');

    await registry.handle(asInteraction(interaction), ctx);

    expect(interaction.reply).toHaveBeenCalledWith({ content: MSG.genericError, flags: MessageFlags.Ephemeral });
  });

  it('rejects two component handlers for the same custom id', () => {
    const h = { customId: 'x', execute: jest.fn() };
    expect(() => new CommandRegistry([], undefined, [h, { ...h }])).toThrow(/x/);
  });

  it('loads the component handlers of commands/, the Battle.net menus included', () => {
    const ids = loadComponentHandlers(COMMANDS_DIR).map((c) => c.customId);
    expect(ids).toEqual(expect.arrayContaining(['bnet-link:main', 'bnet-link:alt']));
  });
});
