/**
 * Cross-cutting access check (IT-038) for PRD `professional-financial-health-
 * dashboard`: every endpoint the feature added in tasks 1 to 3 refuses a request
 * with no token and one with an expired token, with a 401 and nothing else. It
 * boots the real Billing, Financial-health, Academia, Academia-mirror and
 * Backoffice modules against a migrated database.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AcademiaModule } from '@/academia/academia.module';
import { AcademiaMirrorModule } from '@/academia-mirror/academiaMirror.module';
import { BackofficeModule } from '@/backoffice/backoffice.module';
import request from 'supertest';
import {
  FinancialHealthHarness,
  JWT_SECRET,
} from './support/financialHealthHarness';

jest.setTimeout(240_000);

const h = new FinancialHealthHarness(`finauth-${Date.now()}`, [
  AcademiaModule,
  AcademiaMirrorModule,
  BackofficeModule,
]);

type Method = 'get' | 'put' | 'post' | 'patch' | 'delete';

const STUDENT = '/academia/students/00000000-0000-7000-8000-000000000001';

// Every route task 1 (panels, gym billing account), task 2 (recurring billing,
// receptionist notice, student fees) and task 3 (backoffice) added or changed.
const ENDPOINTS: [Method, string][] = [
  ['get', '/financial-health/summary'],
  ['get', '/financial-health/delinquents'],
  ['get', '/billing/account'],
  ['put', '/billing/account'],
  ['delete', '/billing/account'],
  ['post', `${STUDENT}/access-plan`],
  ['delete', `${STUDENT}/access-plan`],
  ['patch', `${STUDENT}/billing`],
  ['get', '/academia/students/billing/eligible'],
  ['post', '/academia/students/billing/activate'],
  [
    'post',
    '/academia/staff/students/00000000-0000-7000-8000-000000000002/checkin',
  ],
  ['get', '/me/academia'],
  ['get', '/backoffice/financial-health/summary'],
  ['get', '/backoffice/financial-health/delinquents'],
];

beforeAll(async () => {
  await h.start();
});

afterAll(async () => {
  await h.stop();
});

describe('Unauthenticated access to every new endpoint (IT-038)', () => {
  it.each(ENDPOINTS)(
    'IT-038 %s %s answers 401 with no token',
    async (method, path) => {
      const response = await request(h.server())[method](path).send({});

      expect(response.status).toBe(401);
      expect(response.body).not.toHaveProperty('items');
      expect(response.body).not.toHaveProperty('current');
    },
  );

  it.each(ENDPOINTS)(
    'IT-038 %s %s answers 401 with an expired token',
    async (method, path) => {
      const user = await h.createUser('expired', h.products.premiumEducator);
      const expired = h.jwt.sign(
        { id: user.id, email: user.email },
        { secret: JWT_SECRET, expiresIn: -60 },
      );

      const response = await request(h.server())
        [method](path)
        .set('Authorization', `Bearer ${expired}`)
        .send({});

      expect(response.status).toBe(401);
    },
  );

  it('IT-038 the same token, still valid, is accepted by a panel route (the 401s above are about the token)', async () => {
    const user = await h.createUser('valid', h.products.premiumEducator);

    const response = await h.summary(user);

    expect(response.status).toBe(200);
  });
});
