import { CodedError } from '@/common/errors/codedError';
import { AcademiaStudentsService } from './academiaStudents.service';

function makeDeps() {
  return {
    clients: {
      findAllByAcademiaId: jest.fn().mockResolvedValue([]),
      assignEducator: jest.fn().mockResolvedValue(true),
    },
    employments: {
      findActive: jest.fn().mockResolvedValue({ id: 'employment-1' }),
    },
  };
}

describe('AcademiaStudentsService', () => {
  it('UT-036 assigns a student to an educator currently ACTIVE-employed at this academia', async () => {
    const deps = makeDeps();
    const service = new AcademiaStudentsService(
      deps.clients as never,
      deps.employments as never,
    );

    await service.assignEducator('academia-1', 'client-1', 'educator-1');

    expect(deps.employments.findActive).toHaveBeenCalledWith(
      'academia-1',
      'educator-1',
    );
    expect(deps.clients.assignEducator).toHaveBeenCalledWith(
      'client-1',
      'academia-1',
      'educator-1',
    );
  });

  it('UT-037 rejects assigning an educator not currently employed by this academia', async () => {
    const deps = makeDeps();
    deps.employments.findActive.mockResolvedValue(null);
    const service = new AcademiaStudentsService(
      deps.clients as never,
      deps.employments as never,
    );

    await expect(
      service.assignEducator('academia-1', 'client-1', 'educator-1'),
    ).rejects.toMatchObject({ code: 'not_employed_here' });
    expect(deps.clients.assignEducator).not.toHaveBeenCalled();
  });

  it('UT-038 clears the assignment when professionalId is null, without re-checking employment', async () => {
    const deps = makeDeps();
    const service = new AcademiaStudentsService(
      deps.clients as never,
      deps.employments as never,
    );

    await service.assignEducator('academia-1', 'client-1', null);

    expect(deps.employments.findActive).not.toHaveBeenCalled();
    expect(deps.clients.assignEducator).toHaveBeenCalledWith(
      'client-1',
      'academia-1',
      null,
    );
  });

  it('rejects when the student does not belong to this academia', async () => {
    const deps = makeDeps();
    deps.clients.assignEducator.mockResolvedValue(false);
    const service = new AcademiaStudentsService(
      deps.clients as never,
      deps.employments as never,
    );

    await expect(
      service.assignEducator('academia-1', 'client-1', null),
    ).rejects.toBeInstanceOf(CodedError);
  });
});
