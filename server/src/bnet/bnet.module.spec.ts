import { Test } from '@nestjs/testing';
import { APP_CONFIG } from '../common/config/config.constants';
import { bnetClientProvider } from './bnet.module';
import { BnetClient } from './client';

describe('BnetModule', () => {
  it('provides a BnetClient built from the configuration', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [{ provide: APP_CONFIG, useValue: { bnetClientId: 'id', bnetClientSecret: 'secret' } }, bnetClientProvider],
    }).compile();

    expect(moduleRef.get(BnetClient)).toBeInstanceOf(BnetClient);
  });
});
