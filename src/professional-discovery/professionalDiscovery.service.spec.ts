import { ClientRegisterService } from '@/clients/register/client.register.service';
import { NotificationsService } from '@/notifications/notifications.service';
import {
  ConnectionRequestWithProfessional,
  ConnectionRequestWithUser,
  ProfessionalDiscoveryRepository,
  ProfessionalWithProfile,
} from '@/repositories/professional-discovery/professionalDiscovery.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConnectionRequest,
  Prisma,
  Product,
  ProfessionalProfile,
  Users,
} from '@prisma/client';
import { ProfessionalDiscoveryService } from './professionalDiscovery.service';

function makeUser(overrides: Partial<Users> = {}): Users {
  const timestamp = new Date('2026-10-01T09:00:00.000Z');
  return {
    id: 'user-1',
    name: 'Usuária',
    email: 'user@example.com',
    password: 'hash',
    avatar: null,
    active: true,
    phone: null,
    birthDate: null,
    productId: null,
    termsAcceptedAt: null,
    healthDataConsentAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    subscriptionCancelAt: null,
    subscriptionCurrentPeriodEnd: null,
    isBackoffice: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    name: 'Nutricionista',
    price: 49,
    groupId: 'group-1',
    type: 'NUTRITIONIST',
    stripeId: null,
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    updatedAt: new Date('2026-10-01T09:00:00.000Z'),
    ...overrides,
  };
}

function makeProfile(
  overrides: Partial<ProfessionalProfile> = {},
): ProfessionalProfile {
  return {
    id: 'profile-1',
    userId: 'professional-1',
    bio: 'Bio',
    specialty: 'Nutrição esportiva',
    priceFrom: null,
    attendsOnline: false,
    updatedAt: new Date('2026-10-01T09:00:00.000Z'),
    ...overrides,
  };
}

function makeProfessional(
  overrides: Partial<ProfessionalWithProfile> = {},
): ProfessionalWithProfile {
  return {
    ...makeUser({ id: 'professional-1', name: 'Dra. Ana' }),
    product: makeProduct(),
    professionalProfile: makeProfile(),
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<ConnectionRequest> = {},
): ConnectionRequest {
  return {
    id: 'request-1',
    userId: 'user-1',
    professionalId: 'professional-1',
    status: 'PENDING',
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    decidedAt: null,
    ...overrides,
  };
}

describe('ProfessionalDiscoveryService', () => {
  const repoSearch = jest.fn();
  const repoFindProfessionalById = jest.fn();
  const repoUpsertProfile = jest.fn();
  const repoFindPendingRequest = jest.fn();
  const repoCreateRequest = jest.fn();
  const repoFindRequestById = jest.fn();
  const repoListByUser = jest.fn();
  const repoListIncomingPending = jest.fn();
  const repoTransitionIfPending = jest.fn();
  const usersFindUnique = jest.fn();
  const clientRegisterPostRegister = jest.fn();
  const notificationsCreate = jest.fn();

  let service: ProfessionalDiscoveryService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProfessionalDiscoveryService,
        {
          provide: ProfessionalDiscoveryRepository,
          useValue: {
            search: repoSearch,
            findProfessionalById: repoFindProfessionalById,
            upsertProfile: repoUpsertProfile,
            findPendingRequest: repoFindPendingRequest,
            createRequest: repoCreateRequest,
            findRequestById: repoFindRequestById,
            listByUser: repoListByUser,
            listIncomingPending: repoListIncomingPending,
            transitionIfPending: repoTransitionIfPending,
          },
        },
        { provide: UserRepository, useValue: { findUnique: usersFindUnique } },
        {
          provide: ClientRegisterService,
          useValue: { postRegister: clientRegisterPostRegister },
        },
        {
          provide: NotificationsService,
          useValue: { create: notificationsCreate },
        },
      ],
    }).compile();

    service = module.get(ProfessionalDiscoveryService);
  });

  describe('search', () => {
    it('UT-001 returns only professionals the repository matched for the type filter', async () => {
      repoSearch.mockResolvedValue([
        makeProfessional({ product: makeProduct({ type: 'NUTRITIONIST' }) }),
      ]);

      const result = await service.search({ type: 'NUTRITIONIST' });

      expect(repoSearch).toHaveBeenCalledWith({ type: 'NUTRITIONIST' });
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('NUTRITIONIST');
    });

    it('UT-002 returns [] for a search matching nothing', async () => {
      repoSearch.mockResolvedValue([]);

      const result = await service.search({ specialty: 'nonexistent' });

      expect(result).toEqual([]);
    });

    it('UT-003 includes a professional with no ProfessionalProfile row, with null fields', async () => {
      repoSearch.mockResolvedValue([
        makeProfessional({
          product: makeProduct({ type: 'PHYSICAL_EDUCATOR' }),
          professionalProfile: null,
        }),
      ]);

      const result = await service.search({ type: 'PHYSICAL_EDUCATOR' });

      expect(result).toHaveLength(1);
      expect(result[0].specialty).toBeNull();
      expect(result[0].priceFrom).toBeNull();
      expect(result[0].attendsOnline).toBe(false);
    });

    it('UT-004 forwards combined price and online filters', async () => {
      repoSearch.mockResolvedValue([
        makeProfessional({
          professionalProfile: makeProfile({
            priceFrom: new Prisma.Decimal(150),
            attendsOnline: true,
          }),
        }),
      ]);

      const result = await service.search({ priceMax: 200, online: true });

      expect(repoSearch).toHaveBeenCalledWith({ priceMax: 200, online: true });
      expect(result).toHaveLength(1);
    });
  });

  describe('getProfile', () => {
    it('UT-005 returns bio/specialty/price with no rating or review field', async () => {
      repoFindProfessionalById.mockResolvedValue(makeProfessional());

      const result = await service.getProfile('professional-1');

      expect(Object.keys(result).sort()).toEqual(
        [
          'attendsOnline',
          'bio',
          'id',
          'name',
          'priceFrom',
          'specialty',
          'type',
        ].sort(),
      );
    });

    it('UT-006 returns null fields, not a 404, when no ProfessionalProfile row exists', async () => {
      repoFindProfessionalById.mockResolvedValue(
        makeProfessional({ professionalProfile: null }),
      );

      const result = await service.getProfile('professional-1');

      expect(result.bio).toBeNull();
      expect(result.specialty).toBeNull();
      expect(result.priceFrom).toBeNull();
    });

    it('throws AppError(404) when the professional does not exist', async () => {
      repoFindProfessionalById.mockResolvedValue(null);

      await expect(service.getProfile('missing')).rejects.toThrow(AppError);
    });
  });

  describe('updateOwnProfile', () => {
    it('persists valid content', async () => {
      repoUpsertProfile.mockResolvedValue(makeProfile());
      repoFindProfessionalById.mockResolvedValue(makeProfessional());

      await service.updateOwnProfile('professional-1', { bio: 'Bio normal' });

      expect(repoUpsertProfile).toHaveBeenCalledWith('professional-1', {
        bio: 'Bio normal',
      });
    });

    it('UT-019 rejects an outcome-guarantee bio before persisting', async () => {
      await expect(
        service.updateOwnProfile('professional-1', {
          bio: 'resultado garantido em 30 dias',
        }),
      ).rejects.toThrow(AppError);
      expect(repoUpsertProfile).not.toHaveBeenCalled();
    });
  });

  describe('requestConnection', () => {
    beforeEach(() => {
      usersFindUnique.mockImplementation(({ id }: { id: string }) =>
        Promise.resolve(
          id === 'user-1'
            ? makeUser({ id: 'user-1', name: 'Usuária' })
            : makeUser({ id: 'professional-1', name: 'Dra. Ana' }),
        ),
      );
    });

    it('UT-007 creates a PENDING request and notifies the professional', async () => {
      repoFindPendingRequest.mockResolvedValue(null);
      repoCreateRequest.mockResolvedValue(makeRequest());

      await service.requestConnection('user-1', 'professional-1');

      expect(repoCreateRequest).toHaveBeenCalledWith(
        'user-1',
        'professional-1',
      );
      expect(notificationsCreate).toHaveBeenCalledWith(
        'professional-1',
        'CONNECTION_REQUEST',
        expect.any(String),
        expect.any(String),
      );
    });

    it('UT-008 throws AppError(409) for a duplicate pending request', async () => {
      repoFindPendingRequest.mockResolvedValue(makeRequest());

      await expect(
        service.requestConnection('user-1', 'professional-1'),
      ).rejects.toThrow(AppError);
      try {
        await service.requestConnection('user-1', 'professional-1');
      } catch (error) {
        expect((error as AppError).getStatus()).toBe(409);
      }
      expect(repoCreateRequest).not.toHaveBeenCalled();
    });

    it('UT-009 succeeds for a different professional despite an existing active connection', async () => {
      repoFindPendingRequest.mockResolvedValue(null);
      repoCreateRequest.mockResolvedValue(
        makeRequest({ professionalId: 'professional-2' }),
      );

      await expect(
        service.requestConnection('user-1', 'professional-2'),
      ).resolves.toBeDefined();
    });

    it('UT-010 succeeds again after a prior DECLINED request for the same pair', async () => {
      // The repository's own pending-only lookup finds nothing even though a
      // DECLINED row exists for this pair (repo query filters status=PENDING).
      repoFindPendingRequest.mockResolvedValue(null);
      repoCreateRequest.mockResolvedValue(makeRequest());

      await expect(
        service.requestConnection('user-1', 'professional-1'),
      ).resolves.toBeDefined();
    });
  });

  describe('listOwnRequests / listIncomingRequests', () => {
    it('UT-011 returns each of the user’s own requests with its current status', async () => {
      const rows: ConnectionRequestWithProfessional[] = [
        {
          ...makeRequest({ id: 'r1', status: 'PENDING' }),
          professional: { id: 'professional-1', name: 'Dra. Ana' },
        },
        {
          ...makeRequest({ id: 'r2', status: 'DECLINED' }),
          professional: { id: 'professional-2', name: 'Dr. Bruno' },
        },
      ];
      repoListByUser.mockResolvedValue(rows);

      const result = await service.listOwnRequests('user-1');

      expect(result.map((r) => r.status)).toEqual(['PENDING', 'DECLINED']);
    });

    it('UT-012 returns [] when the user has zero requests', async () => {
      repoListByUser.mockResolvedValue([]);
      repoListIncomingPending.mockResolvedValue([]);

      expect(await service.listOwnRequests('user-1')).toEqual([]);
      expect(await service.listIncomingRequests('professional-1')).toEqual([]);
    });

    it('UT-015 returns incoming requests with the requester’s name and request time', async () => {
      const createdAt = new Date('2026-10-01T10:00:00.000Z');
      const rows: ConnectionRequestWithUser[] = [
        {
          ...makeRequest({ createdAt }),
          user: { id: 'user-1', name: 'Usuária' },
        },
      ];
      repoListIncomingPending.mockResolvedValue(rows);

      const result = await service.listIncomingRequests('professional-1');

      expect(result[0].userName).toBe('Usuária');
      expect(result[0].createdAt).toEqual(createdAt);
    });
  });

  describe('accept', () => {
    beforeEach(() => {
      usersFindUnique.mockImplementation(({ id }: { id: string }) =>
        Promise.resolve(
          id === 'user-1'
            ? makeUser({
                id: 'user-1',
                name: 'Usuária',
                email: 'usuaria@example.com',
                phone: '(11) 90000-0000',
              })
            : makeUser({ id: 'professional-1', name: 'Dra. Ana' }),
        ),
      );
    });

    it('UT-013 calls ClientRegisterService with the requester’s identity and notifies the user', async () => {
      repoTransitionIfPending.mockResolvedValue(1);
      repoFindRequestById.mockResolvedValue(makeRequest());

      await service.accept('professional-1', 'request-1');

      expect(clientRegisterPostRegister).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Usuária',
          email: 'usuaria@example.com',
        }),
        'professional-1',
      );
      expect(notificationsCreate).toHaveBeenCalledWith(
        'user-1',
        'CONNECTION_REQUEST',
        expect.any(String),
        expect.any(String),
      );
    });

    it('UT-014 forwards the existing account’s real email so ClientRegisterService links it, not a blank identity', async () => {
      repoTransitionIfPending.mockResolvedValue(1);
      repoFindRequestById.mockResolvedValue(makeRequest());

      await service.accept('professional-1', 'request-1');

      const [dto] = clientRegisterPostRegister.mock.calls[0];
      expect(dto.email).toBe('usuaria@example.com');
    });

    it('UT-016 the losing concurrent accept throws AppError(404)', async () => {
      repoTransitionIfPending.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      repoFindRequestById.mockResolvedValue(makeRequest());

      await expect(
        service.accept('professional-1', 'request-1'),
      ).resolves.toBeUndefined();
      await expect(
        service.accept('professional-1', 'request-1'),
      ).rejects.toThrow(AppError);
    });

    it('throws AppError(404) and never creates a Client when the request is not pending', async () => {
      repoTransitionIfPending.mockResolvedValue(0);

      await expect(
        service.accept('professional-1', 'request-1'),
      ).rejects.toThrow(AppError);
      expect(clientRegisterPostRegister).not.toHaveBeenCalled();
    });
  });

  describe('decline', () => {
    beforeEach(() => {
      usersFindUnique.mockResolvedValue(
        makeUser({ id: 'professional-1', name: 'Dra. Ana' }),
      );
    });

    it('UT-017 transitions to DECLINED, notifies the user, and creates no Client row', async () => {
      repoTransitionIfPending.mockResolvedValue(1);
      repoFindRequestById.mockResolvedValue(makeRequest());

      await service.decline('professional-1', 'request-1');

      expect(notificationsCreate).toHaveBeenCalledWith(
        'user-1',
        'CONNECTION_REQUEST',
        expect.any(String),
        expect.any(String),
      );
      expect(clientRegisterPostRegister).not.toHaveBeenCalled();
    });

    it('UT-018 only transitions the targeted request, leaving others untouched', async () => {
      repoTransitionIfPending.mockResolvedValue(1);
      repoFindRequestById.mockResolvedValue(makeRequest({ id: 'request-1' }));

      await service.decline('professional-1', 'request-1');

      expect(repoTransitionIfPending).toHaveBeenCalledWith(
        'request-1',
        'professional-1',
        'DECLINED',
      );
      expect(repoTransitionIfPending).toHaveBeenCalledTimes(1);
    });
  });
});
