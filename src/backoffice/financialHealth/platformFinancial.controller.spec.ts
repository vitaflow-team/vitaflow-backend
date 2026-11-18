import { AuthGuard } from '@/auth/auth.guard';
import { AdminTierGuard } from '@/common/guards/adminTier.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { PlatformFinancialController } from './platformFinancial.controller';
import { PlatformFinancialService } from './platformFinancial.service';

function guardsOf(target: object): unknown[] | undefined {
  return Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined;
}

describe('PlatformFinancialController', () => {
  const proto = PlatformFinancialController.prototype as unknown as Record<
    string,
    object
  >;

  it('puts every route behind AuthGuard and BackofficeGuard, and only the summary behind the admin tier', () => {
    expect(guardsOf(PlatformFinancialController)).toEqual([
      AuthGuard,
      BackofficeGuard,
    ]);
    expect(guardsOf(proto.summary)).toEqual([AdminTierGuard]);
    expect(guardsOf(proto.delinquents)).toBeUndefined();
  });

  it('hands the month and the authenticated staff row to the service, nothing else', async () => {
    const service = {
      summary: jest.fn().mockResolvedValue({ month: '2026-10' }),
      delinquents: jest.fn().mockResolvedValue({ page: 2 }),
    };
    const controller = new PlatformFinancialController(
      service as unknown as PlatformFinancialService,
    );
    const staff = { id: 'staff-1', backofficeTier: null };

    await controller.summary('2026-10');
    await controller.delinquents('2', { user: staff });

    expect(service.summary).toHaveBeenCalledWith('2026-10');
    expect(service.delinquents).toHaveBeenCalledWith(staff, '2');
  });
});
