import { CodedError } from '@/common/errors/codedError';
import { AcademiaAccessPlanService } from './academiaAccessPlan.service';

function makeDeps() {
  return {
    create: jest.fn().mockResolvedValue({ id: 'plan-1' }),
    listByAcademia: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(true),
    deactivate: jest.fn().mockResolvedValue(true),
  };
}

describe('AcademiaAccessPlanService', () => {
  it('UT-044 creates a DAYS plan', async () => {
    const deps = makeDeps();
    const service = new AcademiaAccessPlanService(deps as never);

    await service.create('academia-1', {
      name: 'Mensal',
      validityType: 'DAYS',
      validityValue: 30,
      referencePrice: 129.9,
    });

    expect(deps.create).toHaveBeenCalledWith('academia-1', {
      name: 'Mensal',
      validityType: 'DAYS',
      validityValue: 30,
      referencePrice: 129.9,
    });
  });

  it('UT-045 creates a VISITS plan', async () => {
    const deps = makeDeps();
    const service = new AcademiaAccessPlanService(deps as never);

    await service.create('academia-1', {
      name: 'Pacote 10 acessos',
      validityType: 'VISITS',
      validityValue: 10,
      referencePrice: 199.9,
    });

    expect(deps.create).toHaveBeenCalled();
  });

  it('UT-046 rejects a zero or negative validityValue', async () => {
    const deps = makeDeps();
    const service = new AcademiaAccessPlanService(deps as never);

    await expect(
      service.create('academia-1', {
        name: 'Inválido',
        validityType: 'DAYS',
        validityValue: 0,
        referencePrice: 10,
      }),
    ).rejects.toBeInstanceOf(CodedError);
    expect(deps.create).not.toHaveBeenCalled();
  });

  it('UT-047 rejects an empty name and a negative reference price', async () => {
    const deps = makeDeps();
    const service = new AcademiaAccessPlanService(deps as never);

    await expect(
      service.create('academia-1', {
        name: '   ',
        validityType: 'DAYS',
        validityValue: 30,
        referencePrice: 10,
      }),
    ).rejects.toMatchObject({ code: 'access_plan_invalid' });

    await expect(
      service.create('academia-1', {
        name: 'Plano',
        validityType: 'DAYS',
        validityValue: 30,
        referencePrice: -1,
      }),
    ).rejects.toMatchObject({ code: 'access_plan_invalid' });
  });

  it('UT-048 deactivate() is soft — the repository is asked to flip active, never delete', async () => {
    const deps = makeDeps();
    const service = new AcademiaAccessPlanService(deps as never);

    await service.deactivate('academia-1', 'plan-1');

    expect(deps.deactivate).toHaveBeenCalledWith('plan-1', 'academia-1');
  });

  it('rejects deactivating a plan from a different academia / unknown id', async () => {
    const deps = makeDeps();
    deps.deactivate.mockResolvedValue(false);
    const service = new AcademiaAccessPlanService(deps as never);

    await expect(
      service.deactivate('academia-1', 'plan-1'),
    ).rejects.toMatchObject({ code: 'access_plan_not_found' });
  });

  it('UT-049 allows editing a plan regardless of its active state (no special-cased lock)', async () => {
    const deps = makeDeps();
    const service = new AcademiaAccessPlanService(deps as never);

    await service.update('academia-1', 'plan-1', { name: 'Novo nome' });

    expect(deps.update).toHaveBeenCalledWith('plan-1', 'academia-1', {
      name: 'Novo nome',
    });
  });

  it('rejects updating an unknown plan', async () => {
    const deps = makeDeps();
    deps.update.mockResolvedValue(false);
    const service = new AcademiaAccessPlanService(deps as never);

    await expect(
      service.update('academia-1', 'missing', { name: 'X' }),
    ).rejects.toMatchObject({ code: 'access_plan_not_found' });
  });
});
