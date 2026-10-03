import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';
import { DeclarationController } from './declaration.controller';

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata('__guards__', target) as unknown[]) ?? [];
}

describe('assessments controllers', () => {
  it('UT-170 declares every route under AuthGuard then PhysicalEducatorGuard', () => {
    expect(guardsOf(AssessmentsController)).toEqual([
      AuthGuard,
      PhysicalEducatorGuard,
    ]);
    expect(guardsOf(DeclarationController)).toEqual([
      AuthGuard,
      PhysicalEducatorGuard,
    ]);
  });

  it('passes the page of the query and the educator id from the request', async () => {
    const service = {
      list: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      declarationStatus: jest.fn().mockResolvedValue({ accepted: false }),
    };
    const req = { user: { id: 'educator-1' } };
    const controller = new AssessmentsController(
      service as unknown as AssessmentsService,
    );
    const declaration = new DeclarationController(
      service as unknown as AssessmentsService,
    );

    await controller.list('student-1', { page: 2 }, req);
    await controller.create(
      'student-1',
      { assessedOn: '2026-09-15', weightKg: 78, heightCm: 179 },
      req,
    );
    await declaration.status(req);

    expect(service.list).toHaveBeenCalledWith('educator-1', 'student-1', 2);
    expect(service.create).toHaveBeenCalledWith(
      'educator-1',
      'student-1',
      expect.objectContaining({ weightKg: 78 }),
    );
    expect(service.declarationStatus).toHaveBeenCalledWith('educator-1');
  });
});
