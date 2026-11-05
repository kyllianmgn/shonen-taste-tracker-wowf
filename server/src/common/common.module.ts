import { DynamicModule, Global, Module } from '@nestjs/common';
import type { AppConfig } from './config/config';
import { APP_CONFIG } from './config/config.constants';
import { ContractValidator } from './contract/contract-validator';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';

/** Shared infrastructure: validated configuration, database access, contract validation, health endpoint. */
@Global()
@Module({})
export class CommonModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: CommonModule,
      controllers: [HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        PrismaService,
        { provide: ContractValidator, useFactory: () => new ContractValidator() },
      ],
      exports: [APP_CONFIG, PrismaService, ContractValidator],
    };
  }
}
