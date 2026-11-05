import { LogLevel as NestLogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { LogLevel } from './common/config/config';
import { loadConfigOrExit } from './common/config/load-or-exit';

const PORT = 3000;

/** Nest levels enabled for each LOG_LEVEL value (`info` maps to Nest's `log`). */
const NEST_LEVELS: Record<LogLevel, NestLogLevel[]> = {
  fatal: ['fatal'],
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug'],
  verbose: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

async function bootstrap(): Promise<void> {
  const config = loadConfigOrExit(process.env, {
    exit: (code) => process.exit(code),
    print: (message) => console.error(message),
  });

  const app = await NestFactory.create(AppModule.register(config), { logger: NEST_LEVELS[config.logLevel] });
  app.enableShutdownHooks();
  await app.listen(PORT);
}

void bootstrap();
