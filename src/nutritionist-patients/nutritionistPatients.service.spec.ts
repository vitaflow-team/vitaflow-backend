import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Client } from '@prisma/client';
import { NutritionistPatientsService } from './nutritionistPatients.service';

const NUTRI_A = 'nutri-a';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-1',
    name: 'Diego Martins',
    email: 'diego@exemplo.com',
    phone: '(11) 98888-7777',
    userId: null,
    birthDate: null,
    professionalId: NUTRI_A,
    academiaId: null,
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    updatedAt: new Date('2026-10-01T12:00:00.000Z'),
    ...overrides,
  };
}

describe('NutritionistPatientsService', () => {
  const clients = {
    create: jest.fn(),
    findByEmailAndProfessionalId: jest.fn(),
    getAllByProfessionalId: jest.fn(),
    findOwnedById: jest.fn(),
  };
  const users = { findByEmailInsensitive: jest.fn() };
  let service: NutritionistPatientsService;

  beforeEach(() => {
    jest.clearAllMocks();
    clients.findByEmailAndProfessionalId.mockResolvedValue(null);
    users.findByEmailInsensitive.mockResolvedValue(null);
    clients.create.mockImplementation((data: Record<string, unknown>) =>
      Promise.resolve(client({ ...data, professionalId: undefined })),
    );
    service = new NutritionistPatientsService(
      clients as unknown as ClientsRepository,
      users as unknown as UserRepository,
    );
  });

  describe('create', () => {
    it('registers a patient without a matching account, unlinked', async () => {
      const result = await service.create(NUTRI_A, {
        name: 'Diego Martins',
        email: 'diego@exemplo.com',
      });

      expect(result.hasAccount).toBe(false);
      expect(result.userId).toBeNull();
      expect(clients.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Diego Martins',
          email: 'diego@exemplo.com',
        }),
      );
    });

    it('links immediately when the email matches an existing confirmed account', async () => {
      users.findByEmailInsensitive.mockResolvedValue({
        id: 'user-1',
        active: true,
      });
      clients.create.mockResolvedValue(client({ userId: 'user-1' }));

      const result = await service.create(NUTRI_A, {
        name: 'Diego Martins',
        email: 'diego@exemplo.com',
      });

      expect(result.hasAccount).toBe(true);
      expect(result.userId).toBe('user-1');
      expect(clients.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('does not link when the matching account exists but is unconfirmed', async () => {
      users.findByEmailInsensitive.mockResolvedValue({
        id: 'user-1',
        active: false,
      });

      await service.create(NUTRI_A, {
        name: 'Diego Martins',
        email: 'diego@exemplo.com',
      });

      expect(clients.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ userId: expect.anything() }),
      );
    });

    it('registers a patient with only a phone, no email lookup performed', async () => {
      const result = await service.create(NUTRI_A, {
        name: 'Diego Martins',
        phone: '(11) 98888-7777',
      });

      expect(users.findByEmailInsensitive).not.toHaveBeenCalled();
      expect(result.email).toBe('');
    });

    it('UT-003 rejects a duplicate e-mail already registered for this same nutritionist, 409', async () => {
      clients.findByEmailAndProfessionalId.mockResolvedValue(client());

      await expect(
        service.create(NUTRI_A, { name: 'Outro', email: 'diego@exemplo.com' }),
      ).rejects.toMatchObject({ code: 'duplicate_patient_email', status: 409 });
      expect(clients.create).not.toHaveBeenCalled();
    });

    it('UT-004 allows the same e-mail to be registered independently by a different nutritionist', async () => {
      // findByEmailAndProfessionalId is scoped per professional — a different
      // nutritionist's own lookup resolves to null even if NUTRI_A already
      // has a patient with this e-mail, since the repository call itself is
      // keyed by professionalId.
      clients.findByEmailAndProfessionalId.mockResolvedValue(null);

      const result = await service.create('nutri-b', {
        name: 'Outro Paciente',
        email: 'diego@exemplo.com',
      });

      expect(clients.findByEmailAndProfessionalId).toHaveBeenCalledWith(
        'diego@exemplo.com',
        'nutri-b',
      );
      expect(result).toBeDefined();
      expect(clients.create).toHaveBeenCalled();
    });

    it('UT-005 rejects registration missing a name, 400', async () => {
      await expect(
        service.create(NUTRI_A, {
          // @ts-expect-error -- name omitted deliberately for this test
          name: undefined,
          email: 'diego@exemplo.com',
        }),
      ).rejects.toMatchObject({ code: 'patient_invalid', status: 400 });
      expect(clients.create).not.toHaveBeenCalled();
    });

    it('UT-005 rejects registration missing both phone and email, 400', async () => {
      await expect(
        service.create(NUTRI_A, { name: 'Diego Martins' }),
      ).rejects.toMatchObject({ code: 'patient_invalid', status: 400 });
      expect(clients.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('UT-006 list({ search: "par" }) returns patients matching the term by name or email substring', async () => {
      clients.getAllByProfessionalId.mockResolvedValue([
        client({ id: 'c1', name: 'Parnaíba Silva', email: 'x@y.com' }),
        client({ id: 'c2', name: 'Zeca', email: 'zeca@par.com' }),
        client({ id: 'c3', name: 'Ana', email: 'ana@exemplo.com' }),
      ]);

      const result = await service.list(NUTRI_A, { search: 'par' });

      expect(result.items.map((p) => p.id).sort()).toEqual(['c1', 'c2']);
      expect(result.total).toBe(2);
    });

    it('UT-007 list() for a nutritionist with zero patients returns an empty result, not an error', async () => {
      clients.getAllByProfessionalId.mockResolvedValue([]);

      const result = await service.list(NUTRI_A, {});

      expect(result).toEqual({ items: [], total: 0 });
    });

    it('UT-008 list({ search: "zzz" }) matching nothing returns an empty result, distinct from the zero-patients case', async () => {
      clients.getAllByProfessionalId.mockResolvedValue([client()]);

      const result = await service.list(NUTRI_A, { search: 'zzz' });

      expect(result).toEqual({ items: [], total: 0 });
      expect(clients.getAllByProfessionalId).toHaveBeenCalledWith(NUTRI_A);
    });
  });

  describe('get', () => {
    it('returns the patient when owned by the calling nutritionist', async () => {
      clients.findOwnedById.mockResolvedValue(client());

      const result = await service.get(NUTRI_A, 'client-1');

      expect(result.id).toBe('client-1');
    });

    it('answers 404 for a patient owned by a different professional', async () => {
      clients.findOwnedById.mockResolvedValue(null);

      await expect(service.get(NUTRI_A, 'client-1')).rejects.toMatchObject({
        code: 'patient_not_found',
        status: 404,
      });
    });
  });
});
