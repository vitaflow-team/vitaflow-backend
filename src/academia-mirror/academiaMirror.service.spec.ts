import { Clock } from '@/scheduling/clock.service';
import { AcademiaAccessPlanRepository } from '@/repositories/academia/academiaAccessPlan.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import { StudentAccessPlanService } from '@/academia/checkin/studentAccessPlan.service';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@prisma/client';
import { AcademiaMirrorService } from './academiaMirror.service';

const NOW = new Date('2026-11-11T12:00:00.000Z');

function makeMembership(overrides: Partial<Client> = {}): Client & {
  academia: { name: string };
} {
  const timestamp = new Date('2026-10-01T09:00:00.000Z');
  return {
    id: 'client-1',
    name: 'Aluno',
    email: 'aluno@example.com',
    phone: '',
    userId: 'user-1',
    birthDate: null,
    professionalId: null,
    academiaId: 'academia-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    academia: { name: 'Academia Vitória' },
    ...overrides,
  };
}

describe('AcademiaMirrorService', () => {
  const findAcademiaMembershipsByUserId = jest.fn();
  const currentForClient = jest.fn();
  const findHistoryByClient = jest.fn();
  const findById = jest.fn();

  let service: AcademiaMirrorService;

  beforeEach(async () => {
    jest.clearAllMocks();
    findHistoryByClient.mockResolvedValue([]);
    findById.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AcademiaMirrorService,
        {
          provide: ClientsRepository,
          useValue: { findAcademiaMembershipsByUserId },
        },
        {
          provide: StudentAccessPlanService,
          useValue: { currentForClient },
        },
        {
          provide: StudentAccessPlanRepository,
          useValue: { findHistoryByClient },
        },
        {
          provide: AcademiaAccessPlanRepository,
          useValue: { findById },
        },
        {
          provide: Clock,
          useValue: { now: () => NOW },
        },
      ],
    }).compile();

    service = module.get(AcademiaMirrorService);
  });

  describe('getMemberships', () => {
    it('UT-001 a VALID DAYS plan reports days remaining until expiresAt', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: {
          accessPlanId: 'plan-1',
          validityType: 'DAYS',
          validityValue: 30,
          expiresAt: new Date('2026-11-16T12:00:00.000Z'),
        },
        status: 'VALID',
        remaining: null,
      });
      findById.mockResolvedValue({ name: 'Plano Mensal' });

      const [membership] = await service.getMemberships('user-1');

      expect(membership.currentPlan).toMatchObject({
        status: 'VALID',
        planName: 'Plano Mensal',
        remaining: 5,
      });
    });

    it('UT-002 a VALID VISITS plan reports currentForClient’s own remaining count', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: {
          accessPlanId: 'plan-1',
          validityType: 'VISITS',
          validityValue: 10,
          expiresAt: null,
        },
        status: 'VALID',
        remaining: 7,
      });
      findById.mockResolvedValue({ name: 'Plano 10 visitas' });

      const [membership] = await service.getMemberships('user-1');

      expect(membership.currentPlan).toMatchObject({
        status: 'VALID',
        planName: 'Plano 10 visitas',
        remaining: 7,
      });
    });

    it('UT-003 two memberships at different academias are each independently resolved', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([
        makeMembership({
          id: 'client-1',
          academiaId: 'academia-1',
          academia: { name: 'Academia A' },
        }),
        makeMembership({
          id: 'client-2',
          academiaId: 'academia-2',
          academia: { name: 'Academia B' },
        }),
      ]);
      currentForClient.mockImplementation((clientId: string) =>
        Promise.resolve(
          clientId === 'client-1'
            ? { plan: null, status: 'NO_PLAN', remaining: null }
            : {
                plan: {
                  accessPlanId: 'plan-2',
                  validityType: 'VISITS',
                  validityValue: 5,
                  expiresAt: null,
                },
                status: 'VALID',
                remaining: 3,
              },
        ),
      );
      findById.mockResolvedValue({ name: 'Plano B' });

      const memberships = await service.getMemberships('user-1');

      expect(memberships).toHaveLength(2);
      expect(memberships[0]).toMatchObject({
        academiaName: 'Academia A',
        currentPlan: { status: 'NO_PLAN' },
      });
      expect(memberships[1]).toMatchObject({
        academiaName: 'Academia B',
        currentPlan: { status: 'VALID', planName: 'Plano B', remaining: 3 },
      });
    });

    it('UT-004 an EXPIRED DAYS plan never reports a remaining count', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: {
          accessPlanId: 'plan-1',
          validityType: 'DAYS',
          validityValue: 30,
          expiresAt: new Date('2026-11-11T11:59:59.999Z'),
        },
        status: 'EXPIRED',
        remaining: null,
      });
      findById.mockResolvedValue({ name: 'Plano Mensal' });

      const [membership] = await service.getMemberships('user-1');

      expect(membership.currentPlan).toMatchObject({
        status: 'EXPIRED',
        remaining: null,
      });
    });

    it('UT-005 an EXHAUSTED VISITS plan never reports a remaining count', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: {
          accessPlanId: 'plan-1',
          validityType: 'VISITS',
          validityValue: 5,
          expiresAt: null,
        },
        status: 'EXHAUSTED',
        remaining: 0,
      });
      findById.mockResolvedValue({ name: 'Plano 5 visitas' });

      const [membership] = await service.getMemberships('user-1');

      expect(membership.currentPlan).toMatchObject({
        status: 'EXHAUSTED',
        remaining: null,
      });
    });

    it('UT-006 a membership with no StudentAccessPlan row reports NO_PLAN with every field null', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: null,
        status: 'NO_PLAN',
        remaining: null,
      });

      const [membership] = await service.getMemberships('user-1');

      expect(membership.currentPlan).toEqual({
        status: 'NO_PLAN',
        planName: null,
        validityType: null,
        validityValue: null,
        remaining: null,
      });
      expect(findById).not.toHaveBeenCalled();
    });

    it('UT-007 a caller with zero academia-type Client rows gets an empty array, not an error', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([]);

      const memberships = await service.getMemberships('user-1');

      expect(memberships).toEqual([]);
    });

    it('UT-008 a membership with 2 archived plans maps both into history', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: null,
        status: 'NO_PLAN',
        remaining: null,
      });
      const assignedAt1 = new Date('2026-08-01T00:00:00.000Z');
      const endedAt1 = new Date('2026-09-01T00:00:00.000Z');
      findHistoryByClient.mockResolvedValue([
        {
          id: 'plan-2',
          validityType: 'DAYS',
          validityValue: 30,
          assignedAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-10-01T00:00:00.000Z'),
          accessPlan: { name: 'Plano Mensal' },
        },
        {
          id: 'plan-1',
          validityType: 'VISITS',
          validityValue: 10,
          assignedAt: assignedAt1,
          updatedAt: endedAt1,
          accessPlan: { name: 'Plano 10 visitas' },
        },
      ]);

      const [membership] = await service.getMemberships('user-1');

      expect(membership.history).toEqual([
        {
          id: 'plan-2',
          planName: 'Plano Mensal',
          validityType: 'DAYS',
          validityValue: 30,
          assignedAt: '2026-09-01T00:00:00.000Z',
          endedAt: '2026-10-01T00:00:00.000Z',
        },
        {
          id: 'plan-1',
          planName: 'Plano 10 visitas',
          validityType: 'VISITS',
          validityValue: 10,
          assignedAt: assignedAt1.toISOString(),
          endedAt: endedAt1.toISOString(),
        },
      ]);
    });

    it('UT-009 endedAt is exactly the archived row’s own updatedAt', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: null,
        status: 'NO_PLAN',
        remaining: null,
      });
      const updatedAt = new Date('2026-10-05T14:30:00.000Z');
      findHistoryByClient.mockResolvedValue([
        {
          id: 'plan-1',
          validityType: 'DAYS',
          validityValue: 30,
          assignedAt: new Date('2026-09-05T00:00:00.000Z'),
          updatedAt,
          accessPlan: { name: 'Plano Mensal' },
        },
      ]);

      const [membership] = await service.getMemberships('user-1');

      expect(membership.history[0].endedAt).toBe(updatedAt.toISOString());
    });

    it('UT-010 a membership with zero archived plans has an empty history array', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: null,
        status: 'NO_PLAN',
        remaining: null,
      });
      findHistoryByClient.mockResolvedValue([]);

      const [membership] = await service.getMemberships('user-1');

      expect(membership.history).toEqual([]);
    });

    it('UT-011 history is populated even when the membership currently has NO_PLAN', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: null,
        status: 'NO_PLAN',
        remaining: null,
      });
      findHistoryByClient.mockResolvedValue([
        {
          id: 'plan-1',
          validityType: 'DAYS',
          validityValue: 30,
          assignedAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
          accessPlan: { name: 'Plano Mensal' },
        },
        {
          id: 'plan-2',
          validityType: 'VISITS',
          validityValue: 10,
          assignedAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-10-01T00:00:00.000Z'),
          accessPlan: { name: 'Plano 10 visitas' },
        },
      ]);

      const [membership] = await service.getMemberships('user-1');

      expect(membership.currentPlan.status).toBe('NO_PLAN');
      expect(membership.history).toHaveLength(2);
    });

    it('UT-012 preserves the repository’s own count and order without re-sorting or re-capping', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: null,
        status: 'NO_PLAN',
        remaining: null,
      });
      const rows = Array.from({ length: 20 }, (_, i) => ({
        id: `plan-${i}`,
        validityType: 'DAYS' as const,
        validityValue: 30,
        assignedAt: new Date(2026, 0, 20 - i),
        updatedAt: new Date(2026, 1, 20 - i),
        accessPlan: { name: `Plano ${i}` },
      }));
      findHistoryByClient.mockResolvedValue(rows);

      const [membership] = await service.getMemberships('user-1');

      expect(membership.history).toHaveLength(20);
      expect(membership.history.map((entry) => entry.id)).toEqual(
        rows.map((row) => row.id),
      );
    });

    it('UT-017 a VALID DAYS plan exactly 24h from expiry reports 1 day remaining', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: {
          accessPlanId: 'plan-1',
          validityType: 'DAYS',
          validityValue: 30,
          expiresAt: new Date('2026-11-12T12:00:00.000Z'),
        },
        status: 'VALID',
        remaining: null,
      });
      findById.mockResolvedValue({ name: 'Plano Mensal' });

      const [membership] = await service.getMemberships('user-1');

      expect(membership.currentPlan.remaining).toBe(1);
    });

    it('UT-018 an EXPIRED DAYS plan never shows a countdown', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: {
          accessPlanId: 'plan-1',
          validityType: 'DAYS',
          validityValue: 30,
          expiresAt: new Date('2026-11-01T00:00:00.000Z'),
        },
        status: 'EXPIRED',
        remaining: null,
      });
      findById.mockResolvedValue({ name: 'Plano Mensal' });

      const [membership] = await service.getMemberships('user-1');

      expect(membership.currentPlan.remaining).toBeNull();
    });

    it('UT-019 a VISITS plan at the exhaustion boundary never surfaces a negative remaining', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      // currentForClient can return remaining <= 0 right at the boundary
      // that derives EXHAUSTED — the entity must never show it raw.
      currentForClient.mockResolvedValue({
        plan: {
          accessPlanId: 'plan-1',
          validityType: 'VISITS',
          validityValue: 5,
          expiresAt: null,
        },
        status: 'EXHAUSTED',
        remaining: -2,
      });
      findById.mockResolvedValue({ name: 'Plano 5 visitas' });

      const [membership] = await service.getMemberships('user-1');

      expect(membership.currentPlan.remaining).toBeNull();
    });

    it('UT-020 no non-VALID status entity carries any call-to-action-shaped field', async () => {
      findAcademiaMembershipsByUserId.mockResolvedValue([makeMembership()]);
      currentForClient.mockResolvedValue({
        plan: null,
        status: 'NO_PLAN',
        remaining: null,
      });

      const [membership] = await service.getMemberships('user-1');

      expect(Object.keys(membership.currentPlan).sort()).toEqual(
        [
          'planName',
          'remaining',
          'status',
          'validityType',
          'validityValue',
        ].sort(),
      );
    });
  });
});
