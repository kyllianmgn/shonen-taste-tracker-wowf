import { Test } from '@nestjs/testing';
import type { AppConfig } from '../config/config';
import { CommonModule } from '../common.module';
import { ContractValidator } from './contract-validator';

describe('CommonModule contract wiring', () => {
  it('provides a ContractValidator loaded from contract/schemas', async () => {
    const config = { databaseUrl: 'postgresql://ft:pw@localhost:5432/ft' } as AppConfig;
    const moduleRef = await Test.createTestingModule({ imports: [CommonModule.register(config)] }).compile();

    const validator = moduleRef.get(ContractValidator);

    expect(validator.validate('heartbeat.request', { sentAt: 1, gameRunning: true, appVersion: '0.1.0' })).toEqual({
      ok: true,
    });
    await moduleRef.close();
  });
});
