/**
 * Integration tests for PRD `professional-mirror` (task_01, backend).
 *
 * Runs the real ProfessionalMirrorController/ProfessionalMirrorService,
 * AuthGuard, and the real cross-module read into ProfessionalDiscoveryService
 * (unmocked, per _tests.md Strategy) against an isolated database.
 *
 * Requires `TEST_DATABASE_URL` pointing at an isolated, migrated database.
 */
import { AuthGuard } from '@/auth/auth.guard';
import { PrismaService } from '@/database/prisma.service';
import { ProfessionalDiscoveryService } from '@/professional-discovery/professionalDiscovery.service';
import { ProfessionalMirrorController } from '@/professional-mirror/professionalMirror.controller';
import { ProfessionalMirrorService } from '@/professional-mirror/professionalMirror.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { ProfessionalDiscoveryRepository } from '@/repositories/professional-discovery/professionalDiscovery.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, ProductType, Users } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

jest.setTimeout(30_000);

const RUN_TAG = `promirror-${Date.now()}`;

describe('Professional Mirror integration', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let groupId: string;
  let nutritionist: Users;
  let user: Users;
  const jwtSecret = 'professional-mirror-integration-jwt-secret';

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL must point to an isolated migrated test database',
      );
    }
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = jwtSecret;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: jwtSecret })],
      controllers: [ProfessionalMirrorController],
      providers: [
        PrismaService,
        UserRepository,
        ClientsRepository,
        ProfessionalDiscoveryRepository,
        ProfessionalDiscoveryService,
        ProfessionalMirrorService,
        AuthGuard,
      ],
    }).compile();
    moduleFixture.useLogger(false);

    app = moduleFixture.createNestApplication<App>();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    jwtService = moduleFixture.get(JwtService);

    await seedUsers();
  });

  afterEach(async () => {
    await prisma.client.deleteMany({
      where: { professionalId: nutritionist.id },
    });
  });

  afterAll(async () => {
    const userIds = [nutritionist, user].filter(Boolean).map((u) => u.id);
    await prisma.professionalProfile.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.users.deleteMany({ where: { id: { in: userIds } } });
    await prisma.product.deleteMany({ where: { groupId } });
    await prisma.productGroup.deleteMany({ where: { id: groupId } });
    await prisma.$disconnect();
    await app.close();
  });

  async function seedUsers(): Promise<void> {
    const group = await prisma.productGroup.create({
      data: {
        name: `${RUN_TAG} group`,
        products: {
          create: [
            {
              name: `${RUN_TAG} nutri`,
              price: 10,
              type: ProductType.NUTRITIONIST,
            },
          ],
        },
      },
      include: { products: true },
    });
    groupId = group.id;

    nutritionist = await createUser('nutri', {
      productId: group.products[0].id,
    });
    user = await createUser('user', {});

    await prisma.professionalProfile.create({
      data: {
        userId: nutritionist.id,
        bio: 'Bio da nutricionista',
        specialty: 'Nutrição esportiva',
      },
    });
  }

  async function createUser(
    label: string,
    extra: Partial<Prisma.UsersUncheckedCreateInput>,
  ): Promise<Users> {
    return await prisma.users.create({
      data: {
        name: `Professional Mirror ${label}`,
        email: `${RUN_TAG}-${label}@integration.test`,
        password: 'unused-in-integration-test',
        active: true,
        ...extra,
      },
    });
  }

  async function bearerFor(target: Users): Promise<string> {
    const token = await jwtService.signAsync({
      id: target.id,
      email: target.email,
    });
    return `Bearer ${token}`;
  }

  it('IT-001 a real accepted Client + ProfessionalProfile populates identity, every contract field null', async () => {
    await prisma.client.create({
      data: {
        name: user.name,
        email: user.email,
        phone: '',
        userId: user.id,
        professional: { connect: { id: nutritionist.id } },
      },
    });

    const response = await request(app.getHttpServer())
      .get('/me/nutritionist')
      .set('Authorization', await bearerFor(user));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      professional: {
        id: nutritionist.id,
        name: nutritionist.name,
        specialty: 'Nutrição esportiva',
      },
      mealPlan: null,
      nextConsultation: null,
      billingStatus: null,
    });
  });

  it('IT-002 no Client link returns { hasProfessional: false }', async () => {
    const response = await request(app.getHttpServer())
      .get('/me/nutritionist')
      .set('Authorization', await bearerFor(user));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hasProfessional: false });
  });

  it('IT-003 a nutritionist-only link leaves the educator mirror unlinked', async () => {
    await prisma.client.create({
      data: {
        name: user.name,
        email: user.email,
        phone: '',
        userId: user.id,
        professional: { connect: { id: nutritionist.id } },
      },
    });

    const nutritionistMirror = await request(app.getHttpServer())
      .get('/me/nutritionist')
      .set('Authorization', await bearerFor(user));
    const educatorMirror = await request(app.getHttpServer())
      .get('/me/physical-educator')
      .set('Authorization', await bearerFor(user));

    expect(nutritionistMirror.body.professional?.id).toBe(nutritionist.id);
    expect(educatorMirror.body).toEqual({ hasProfessional: false });
  });
});
