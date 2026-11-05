import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/common/config/config';
import { DISCORD_CLIENT } from '../src/discord/client/discord-client.service';
import { FakeDiscordClient } from './fake-discord-client';

describe('GET /health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(loadConfig(process.env))],
    })
      .overrideProvider(DISCORD_CLIENT)
      .useValue(new FakeDiscordClient())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 200 when the database and the Discord connection are up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body).toEqual({ status: 'ok', database: 'up', discord: 'up' });
  });
});
