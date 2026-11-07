import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PlayerAccountService } from '../core/players/player-account.service';

/**
 * Every hour: deletes the characters left without owner by /quitter, with their snapshots and
 * events (docs/02 « Modèle de données »).
 */
@Injectable()
export class OrphanCleanupJob implements OnApplicationBootstrap, OnModuleDestroy {
  static readonly INTERVAL_MS = 3_600_000;
  private readonly logger = new Logger(OrphanCleanupJob.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly accounts: PlayerAccountService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), OrphanCleanupJob.INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      const count = await this.accounts.deleteOrphanCharacters();
      if (count > 0) this.logger.log(`Deleted ${count} orphan character(s)`);
    } catch (error) {
      this.logger.error('Orphan cleanup job failed', error as Error);
    }
  }
}
