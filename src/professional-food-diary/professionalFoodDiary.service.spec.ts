import { EmploymentRepository } from '@/repositories/academia/employment.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { MealsRepository } from '@/repositories/food-diary/meals.repository';
import { WaterLogRepository } from '@/repositories/food-diary/waterLog.repository';
import { Client } from '@prisma/client';
import { ProfessionalFoodDiaryService } from './professionalFoodDiary.service';

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-1',
    name: 'Paciente',
    email: 'p@x.com',
    phone: '',
    userId: 'user-1',
    birthDate: null,
    professionalId: 'nutri-1',
    academiaId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ProfessionalFoodDiaryService', () => {
  const clients = { getClientById: jest.fn() };
  const employments = { findActive: jest.fn() };
  const meals = { findByUserForProfessional: jest.fn() };
  const waterLogs = { findByUserForProfessional: jest.fn() };
  let service: ProfessionalFoodDiaryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProfessionalFoodDiaryService(
      clients as unknown as ClientsRepository,
      employments as unknown as EmploymentRepository,
      meals as unknown as MealsRepository,
      waterLogs as unknown as WaterLogRepository,
    );
  });

  it("UT-048 returns the patient's Meal/WaterLog entries, newest first", async () => {
    clients.getClientById.mockResolvedValue(client());
    meals.findByUserForProfessional.mockResolvedValue([
      {
        id: 'm1',
        mealType: 'LUNCH',
        description: 'Arroz e feijão',
        calories: 500,
        loggedAt: new Date('2026-10-15T12:00:00.000Z'),
      },
    ]);
    waterLogs.findByUserForProfessional.mockResolvedValue([
      { date: new Date('2026-10-15T00:00:00.000Z'), count: 4 },
    ]);

    const result = await service.getDiary('nutri-1', undefined, 'client-1');

    expect(meals.findByUserForProfessional).toHaveBeenCalledWith('user-1');
    expect(waterLogs.findByUserForProfessional).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({
      hasAccount: true,
      meals: [
        {
          id: 'm1',
          mealType: 'LUNCH',
          description: 'Arroz e feijão',
          calories: 500,
          loggedAt: '2026-10-15T12:00:00.000Z',
        },
      ],
      waterLogs: [{ date: '2026-10-15', count: 4 }],
    });
  });

  it('UT-049 a Client with no linked userId returns a clean empty response, not an error', async () => {
    clients.getClientById.mockResolvedValue(client({ userId: null }));

    const result = await service.getDiary('nutri-1', undefined, 'client-1');

    expect(result).toEqual({ hasAccount: false, meals: [], waterLogs: [] });
    expect(meals.findByUserForProfessional).not.toHaveBeenCalled();
    expect(waterLogs.findByUserForProfessional).not.toHaveBeenCalled();
  });

  it('UT-050 a linked Client who never logged anything is a distinct empty state from UT-049', async () => {
    clients.getClientById.mockResolvedValue(client({ userId: 'user-1' }));
    meals.findByUserForProfessional.mockResolvedValue([]);
    waterLogs.findByUserForProfessional.mockResolvedValue([]);

    const result = await service.getDiary('nutri-1', undefined, 'client-1');

    expect(result).toEqual({ hasAccount: true, meals: [], waterLogs: [] });
  });

  it('answers 404 for a client the caller does not own', async () => {
    clients.getClientById.mockResolvedValue(
      client({ professionalId: 'other-nutri' }),
    );

    await expect(
      service.getDiary('nutri-1', undefined, 'client-1'),
    ).rejects.toMatchObject({ code: 'client_not_found', status: 404 });
    expect(meals.findByUserForProfessional).not.toHaveBeenCalled();
  });

  it('answers 404 (not 403) for a client that does not exist at all', async () => {
    clients.getClientById.mockResolvedValue(null);

    await expect(
      service.getDiary('nutri-1', undefined, 'client-1'),
    ).rejects.toMatchObject({ code: 'client_not_found', status: 404 });
  });

  it('allows an academia owner/manager for an academia-owned client', async () => {
    clients.getClientById.mockResolvedValue(
      client({ academiaId: 'academia-1', professionalId: null }),
    );

    const result = await service.getDiary('owner-1', 'academia-1', 'client-1');

    expect(result.hasAccount).toBe(true);
  });

  it('allows the currently assigned employed educator for an academia-owned client', async () => {
    clients.getClientById.mockResolvedValue(
      client({ academiaId: 'academia-1', professionalId: 'edu-1' }),
    );
    employments.findActive.mockResolvedValue({ id: 'employment-1' });

    const result = await service.getDiary('edu-1', undefined, 'client-1');

    expect(employments.findActive).toHaveBeenCalledWith('academia-1', 'edu-1');
    expect(result.hasAccount).toBe(true);
  });

  it('answers 404 for an employed educator with no active employment at that academia', async () => {
    clients.getClientById.mockResolvedValue(
      client({ academiaId: 'academia-1', professionalId: 'edu-1' }),
    );
    employments.findActive.mockResolvedValue(null);

    await expect(
      service.getDiary('edu-1', undefined, 'client-1'),
    ).rejects.toMatchObject({ code: 'client_not_found', status: 404 });
  });
});
