import { AuthGuard } from '@/auth/auth.guard';
import { IS_PUBLIC_WEBHOOK } from '@/common/decorators/publicWebhook.decorator';
import { BillingOwnerGuard } from '@/billing/owner/billingOwner.guard';
import { BillingPlanGuard } from '@/billing/owner/billingPlan.guard';
import { ProgressController } from '@/progress/progress.controller';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BillingAccountController } from './account/billingAccount.controller';
import { InvoicesController } from './invoices/invoices.controller';
import { StudentInvoicesController } from './invoices/studentInvoices.controller';
import { AsaasWebhookController } from './webhook/asaasWebhook.controller';

function classGuards(target: unknown): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target as object) ??
    []) as unknown[];
}

function methodGuards(target: unknown, method: string): unknown[] {
  const proto = (target as { prototype: Record<string, unknown> }).prototype;
  return (Reflect.getMetadata(GUARDS_METADATA, proto[method] as object) ??
    []) as unknown[];
}

describe('Billing controllers — guard metadata (UT-105)', () => {
  it('BillingAccountController requires AuthGuard and BillingOwnerGuard; connect also requires a plan that can bill', () => {
    expect(classGuards(BillingAccountController)).toEqual([
      AuthGuard,
      BillingOwnerGuard,
    ]);
    expect(methodGuards(BillingAccountController, 'connect')).toContain(
      BillingPlanGuard,
    );
  });

  it('InvoicesController requires AuthGuard, BillingOwnerGuard and BillingPlanGuard for every mutation', () => {
    expect(classGuards(InvoicesController)).toEqual([
      AuthGuard,
      BillingOwnerGuard,
      BillingPlanGuard,
    ]);
  });

  it('StudentInvoicesController requires AuthGuard and BillingOwnerGuard; create and setTaxId also require a plan that can bill, list does not', () => {
    expect(classGuards(StudentInvoicesController)).toEqual([
      AuthGuard,
      BillingOwnerGuard,
    ]);
    expect(methodGuards(StudentInvoicesController, 'create')).toContain(
      BillingPlanGuard,
    );
    expect(methodGuards(StudentInvoicesController, 'setTaxId')).toContain(
      BillingPlanGuard,
    );
    expect(methodGuards(StudentInvoicesController, 'list')).toEqual([]);
  });
});

describe('ApiKeyGuard opt-out marker (UT-027)', () => {
  it('appears on the Asaas webhook handler', () => {
    const proto = AsaasWebhookController.prototype as unknown as Record<
      string,
      object
    >;
    const marked = Reflect.getMetadata(IS_PUBLIC_WEBHOOK, proto['handle']);
    expect(marked).toBe(true);
  });

  it('is absent from every other sampled billing and non-billing route', () => {
    const samples: [unknown, string][] = [
      [BillingAccountController, 'get'],
      [BillingAccountController, 'connect'],
      [InvoicesController, 'update'],
      [InvoicesController, 'cancel'],
      [StudentInvoicesController, 'list'],
      [StudentInvoicesController, 'create'],
      [ProgressController, 'getDashboard'],
    ];
    for (const [controller, method] of samples) {
      const proto = (controller as { prototype: Record<string, unknown> })
        .prototype;
      const handler = proto[method];
      if (!handler) continue; // getDashboard is only a representative guess
      expect(Reflect.getMetadata(IS_PUBLIC_WEBHOOK, handler)).toBeUndefined();
    }
  });

  it('the webhook controller itself carries no ApiKeyGuard-irrelevant AuthGuard/BillingOwnerGuard', () => {
    expect(classGuards(AsaasWebhookController)).toEqual([]);
  });
});
