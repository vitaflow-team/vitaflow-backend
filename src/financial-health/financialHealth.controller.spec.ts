import { AuthGuard } from '@/auth/auth.guard';
import { BillingOwnerGuard } from '@/billing/owner/billingOwner.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FinancialHealthController } from './financialHealth.controller';

describe('FinancialHealthController guard metadata', () => {
  it('both panel routes sit behind AuthGuard and BillingOwnerGuard, with no plan gate', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      FinancialHealthController,
    ) as unknown[];
    expect(guards).toEqual([AuthGuard, BillingOwnerGuard]);

    const proto = FinancialHealthController.prototype as unknown as Record<
      string,
      object
    >;
    for (const method of ['summary', 'delinquents']) {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, proto[method]),
      ).toBeUndefined();
    }
  });
});
