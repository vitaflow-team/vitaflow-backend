import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupApp } from './main';

describe('Bootstrap (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await setupApp();
    await app.init();
  }, 15000);

  afterAll(async () => {
    await app.close();
  });

  it('should return 200 on Swagger UI', async () => {
    const res = await request(app.getHttpServer()).get('/swagger/api');
    expect(res.status).toBe(200);
  });

  it('should apply ValidationPipe globally', async () => {
    const res = await request(app.getHttpServer())
      .post('/some-endpoint')
      .send({ invalidField: 'invalid' });

    expect(res.status).toBe(404);
  });
});
