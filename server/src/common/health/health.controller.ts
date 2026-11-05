import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HealthRegistry } from './health.registry';

type Status = 'up' | 'down';

export type HealthStatus = { status: 'ok' | 'error'; database: Status } & Record<string, string>;

/**
 * Liveness for Docker / Caddy: the database plus every registered check (the Discord connection,
 * registered by the discord module). 503 as soon as one is down.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: HealthRegistry,
  ) {}

  @Get()
  async check(): Promise<HealthStatus> {
    const [database, others] = await Promise.all([this.databaseUp(), this.registry.run()]);
    const statuses: Record<string, Status> = { database: database ? 'up' : 'down' };
    for (const [name, up] of Object.entries(others)) statuses[name] = up ? 'up' : 'down';

    const healthy = Object.values(statuses).every((s) => s === 'up');
    const body = { status: healthy ? 'ok' : 'error', ...statuses } as HealthStatus;
    if (!healthy) throw new ServiceUnavailableException(body);
    return body;
  }

  private async databaseUp(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
