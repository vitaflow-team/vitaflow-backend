import { CodedError } from '@/common/errors/codedError';
import { ServicePackageService } from './servicePackage.service';

function makeDeps() {
  return {
    create: jest.fn().mockResolvedValue({ id: 'package-1' }),
    listByProfessional: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(true),
    deactivate: jest.fn().mockResolvedValue(true),
  };
}

describe('ServicePackageService', () => {
  it('UT-012 create() scopes an active package to the calling professionalId', async () => {
    const deps = makeDeps();
    const service = new ServicePackageService(deps as never);

    await service.create('professional-1', {
      name: 'Pacote mensal',
      sessionCount: 4,
      referencePrice: 399.9,
    });

    expect(deps.create).toHaveBeenCalledWith('professional-1', {
      name: 'Pacote mensal',
      sessionCount: 4,
      referencePrice: 399.9,
    });
  });

  it('UT-013 create() rejects sessionCount <= 0', async () => {
    const deps = makeDeps();
    const service = new ServicePackageService(deps as never);

    await expect(
      service.create('professional-1', {
        name: 'Pacote inválido',
        sessionCount: 0,
        referencePrice: 100,
      }),
    ).rejects.toBeInstanceOf(CodedError);
    expect(deps.create).not.toHaveBeenCalled();

    await expect(
      service.create('professional-1', {
        name: 'Pacote inválido',
        sessionCount: -1,
        referencePrice: 100,
      }),
    ).rejects.toMatchObject({ code: 'service_package_invalid' });
  });

  it('UT-014 create() rejects a negative referencePrice', async () => {
    const deps = makeDeps();
    const service = new ServicePackageService(deps as never);

    await expect(
      service.create('professional-1', {
        name: 'Pacote inválido',
        sessionCount: 4,
        referencePrice: -1,
      }),
    ).rejects.toMatchObject({ code: 'service_package_invalid' });
    expect(deps.create).not.toHaveBeenCalled();
  });

  it('UT-015 create() allows two packages with the same sessionCount and different prices (no uniqueness constraint)', async () => {
    const deps = makeDeps();
    const service = new ServicePackageService(deps as never);

    await service.create('professional-1', {
      name: 'Pacote A',
      sessionCount: 4,
      referencePrice: 100,
    });
    await service.create('professional-1', {
      name: 'Pacote B',
      sessionCount: 4,
      referencePrice: 200,
    });

    expect(deps.create).toHaveBeenCalledTimes(2);
  });

  it('UT-016 behaves identically for a PHYSICAL_EDUCATOR professionalId as for a NUTRITIONIST one — no role branching in the service', async () => {
    const deps = makeDeps();
    const service = new ServicePackageService(deps as never);

    await service.create('nutritionist-1', {
      name: 'Pacote',
      sessionCount: 4,
      referencePrice: 100,
    });
    await service.create('educator-1', {
      name: 'Pacote',
      sessionCount: 4,
      referencePrice: 100,
    });

    expect(deps.create).toHaveBeenNthCalledWith(1, 'nutritionist-1', {
      name: 'Pacote',
      sessionCount: 4,
      referencePrice: 100,
    });
    expect(deps.create).toHaveBeenNthCalledWith(2, 'educator-1', {
      name: 'Pacote',
      sessionCount: 4,
      referencePrice: 100,
    });
  });

  it('UT-017 update() edits name/referencePrice/sessionCount in place — no versioning', async () => {
    const deps = makeDeps();
    const service = new ServicePackageService(deps as never);

    await service.update('professional-1', 'package-1', {
      name: 'Novo nome',
      sessionCount: 6,
      referencePrice: 450,
    });

    expect(deps.update).toHaveBeenCalledWith('package-1', 'professional-1', {
      name: 'Novo nome',
      sessionCount: 6,
      referencePrice: 450,
    });
  });

  it('UT-018 deactivate() is soft — the repository is asked to flip active, never delete', async () => {
    const deps = makeDeps();
    const service = new ServicePackageService(deps as never);

    await service.deactivate('professional-1', 'package-1');

    expect(deps.deactivate).toHaveBeenCalledWith('package-1', 'professional-1');
  });

  it('UT-019 any method against a professionalId that does not own the package returns not-found, never mutating or exposing it', async () => {
    const deps = makeDeps();
    deps.update.mockResolvedValue(false);
    deps.deactivate.mockResolvedValue(false);
    const service = new ServicePackageService(deps as never);

    await expect(
      service.update('other-professional', 'package-1', { name: 'X' }),
    ).rejects.toMatchObject({ code: 'service_package_not_found' });

    await expect(
      service.deactivate('other-professional', 'package-1'),
    ).rejects.toMatchObject({ code: 'service_package_not_found' });
  });
});
