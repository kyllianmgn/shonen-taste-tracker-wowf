import { AppConfig, ConfigError, Env, loadConfig } from './config';

export interface ExitHooks {
  exit: (code: number) => never;
  print: (message: string) => void;
}

/** Validates the configuration before anything else starts; a bad config stops the process at once. */
export function loadConfigOrExit(env: Env, hooks: ExitHooks): AppConfig {
  try {
    return loadConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) {
      hooks.print(e.message);
      return hooks.exit(1);
    }
    throw e;
  }
}
