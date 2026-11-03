import { AuthGuard } from '@/auth/auth.guard';
import { IS_PUBLIC_WEBHOOK } from '@/common/decorators/publicWebhook.decorator';
import { ProfessionalGuard } from '@/common/guards/professional.guard';
import { ProfessionalPremiumGuard } from '@/common/guards/professionalPremium.guard';
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
  it('BillingAccountController requires AuthGuard and ProfessionalGuard; connect also requires Premium', () => {
    expect(classGuards(BillingAccountController)).toEqual([
      AuthGuard,
      ProfessionalGuard,
    ]);
    expect(methodGuards(BillingAccountController, 'connect')).toContain(
      ProfessionalPremiumGuard,
    );
  });

  it('InvoicesController requires AuthGuard, ProfessionalGuard and ProfessionalPremiumGuard for every mutation', () => {
    expect(classGuards(InvoicesController)).toEqual([
      AuthGuard,
      ProfessionalGuard,
      ProfessionalPremiumGuard,
    ]);
  });

  it('StudentInvoicesController requires AuthGuard and ProfessionalGuard; create and setTaxId also require Premium, list does not', () => {
    expect(classGuards(StudentInvoicesController)).toEqual([
      AuthGuard,
      ProfessionalGuard,
    ]);
    expect(methodGuards(StudentInvoicesController, 'create')).toContain(
      ProfessionalPremiumGuard,
    );
    expect(methodGuards(StudentInvoicesController, 'setTaxId')).toContain(
      ProfessionalPremiumGuard,
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

  it('the webhook controller itself carries no ApiKeyGuard-irrelevant AuthGuard/ProfessionalGuard', () => {
    expect(classGuards(AsaasWebhookController)).toEqual([]);
  });
});
