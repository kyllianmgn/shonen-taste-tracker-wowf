import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_CONFIG } from '../common/config/config.constants';
import { BnetModule } from './bnet.module';
import { BnetClient } from './client';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useValue: { bnetClientId: 'id', bnetClientSecret: 'secret' } }],
  exports: [APP_CONFIG],
})
class FakeConfigModule {}

describe('BnetModule', () => {
  it('provides a BnetClient built from the configuration', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakeConfigModule, BnetModule] }).compile();

    expect(moduleRef.get(BnetClient)).toBeInstanceOf(BnetClient);
  });
});
