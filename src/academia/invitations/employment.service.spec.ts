import { CodedError } from '@/common/errors/codedError';
import { EmploymentService } from './employment.service';

describe('EmploymentService', () => {
  function makeDeps() {
    return {
      findById: jest.fn().mockResolvedValue({
        id: 'employment-1',
        academiaId: 'academia-1',
        educatorId: 'educator-1',
        status: 'ACTIVE',
      }),
      end: jest.fn().mockResolvedValue(true),
      listActiveByAcademia: jest.fn().mockResolvedValue([]),
      listActiveByEducator: jest.fn().mockResolvedValue([]),
    };
  }

  function makeActivity() {
    return { recordActivity: jest.fn().mockResolvedValue(undefined) };
  }

  it('UT-024 ends an active employment belonging to this academia', async () => {
    const deps = makeDeps();
    const service = new EmploymentService(
      deps as never,
      makeActivity() as never,
    );

    await service.end('academia-1', 'employment-1');

    expect(deps.end).toHaveBeenCalledWith('academia-1', 'employment-1');
  });

  it('rejects ending an employment that belongs to a DIFFERENT academia', async () => {
    const deps = makeDeps();
    const service = new EmploymentService(
      deps as never,
      makeActivity() as never,
    );

    await expect(
      service.end('other-academia', 'employment-1'),
    ).rejects.toBeInstanceOf(CodedError);
    expect(deps.end).not.toHaveBeenCalled();
  });

  it('rejects ending an employment that does not exist', async () => {
    const deps = makeDeps();
    deps.findById.mockResolvedValue(null);
    const service = new EmploymentService(
      deps as never,
      makeActivity() as never,
    );

    await expect(service.end('academia-1', 'missing')).rejects.toMatchObject({
      code: 'employment_not_found',
    });
  });

  it('fans out an activity notification to the owner on end()', async () => {
    const deps = makeDeps();
    const activity = makeActivity();
    const service = new EmploymentService(deps as never, activity as never);

    await service.end('academia-1', 'employment-1');

    expect(activity.recordActivity).toHaveBeenCalledWith(
      'academia-1',
      expect.any(String),
    );
  });
});
