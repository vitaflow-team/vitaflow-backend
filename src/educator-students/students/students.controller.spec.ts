import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { AccountLookupThrottlerGuard } from './accountLookupThrottler.guard';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];
}

describe('StudentsController', () => {
  it('UT-101 declares every route under AuthGuard then PhysicalEducatorGuard', () => {
    expect(guardsOf(StudentsController)).toEqual([
      AuthGuard,
      PhysicalEducatorGuard,
    ]);
  });

  it('UT-101 puts the throttler on the account lookup only', () => {
    const methodOf = (name: string): object =>
      Object.getOwnPropertyDescriptor(StudentsController.prototype, name)
        ?.value as object;

    expect(guardsOf(methodOf('lookupAccount'))).toContain(
      AccountLookupThrottlerGuard,
    );
    for (const name of ['list', 'create', 'get', 'update', 'remove']) {
      expect(guardsOf(methodOf(name))).not.toContain(
        AccountLookupThrottlerGuard,
      );
    }
  });

  it('reads the educator id only from the authenticated request', async () => {
    const service = {
      list: jest.fn().mockResolvedValue({}),
      get: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new StudentsController(
      service as unknown as StudentsService,
    );
    const req = { user: { id: 'educator-1' } };

    await controller.list({ search: 'ana' }, req);
    await controller.get('student-1', req);
    await controller.remove('student-1', req);

    expect(service.list).toHaveBeenCalledWith('educator-1', { search: 'ana' });
    expect(service.get).toHaveBeenCalledWith('educator-1', 'student-1');
    expect(service.remove).toHaveBeenCalledWith('educator-1', 'student-1');
  });
});
