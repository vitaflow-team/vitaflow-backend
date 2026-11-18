import { buildAssignment } from '@/academia/checkin/accessPlanAssignment';
import { InvoicesService } from '@/billing/invoices/invoices.service';
import { ownsClient } from '@/billing/owner/billingOwnerRules';
import type { BillingOwner } from '@/billing/owner/types/billingOwner';
import { brasiliaDateKey } from '@/billing/shared/dates';
import { CodedError } from '@/common/errors/codedError';
import { AcademiaAccessPlanRepository } from '@/repositories/academia/academiaAccessPlan.repository';
import { GymRecurringBillingRepository } from '@/repositories/academia/gymRecurringBilling.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import type { BillingTermsChange } from '@/repositories/academia/types/billingTermsChange';
import type { LinkedRows } from '@/repositories/academia/types/linkedRows';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { Clock } from '@/scheduling/clock.service';
import { Injectable, Logger } from '@nestjs/common';
import {
  AcademiaAccessPlan,
  Client,
  GymRecurringBilling,
  StudentAccessPlan,
} from '@prisma/client';
import * as Sentry from '@sentry/node';
import type { AssignAccessPlanResponseDTO } from './dto/assignAccessPlanResponse.Dto';
import type { RecurringBillingResponseDTO } from './dto/recurringBillingResponse.Dto';
import {
  defaultDueDay,
  effectiveAmountCents,
  firstFeeOf,
  parseAmountCents,
  parseDueDay,
  priceToCents,
} from './recurringBillingRules';
import { toBillingView } from './recurringBillingView';
import type { BillingTermsInput } from './types/billingTermsInput';
import type { ChangeTermsInput } from './types/changeTermsInput';
import type { LinkWithBillingInput } from './types/linkWithBillingInput';
import type { RecurringTerms } from './types/recurringTerms';
import type { UnlinkInput } from './types/unlinkInput';

const STUDENT_NOT_FOUND = 'Aluno não encontrado nesta academia.';
const PLAN_NOT_FOUND = 'Plano de acesso não encontrado.';
const BILLING_EXISTS =
  'Este aluno já tem cobrança recorrente. Altere ou encerre o plano atual primeiro.';
const BILLING_NOT_FOUND = 'Este aluno não tem cobrança recorrente ativa.';
const NO_PLAN = 'Este aluno não tem plano de acesso.';

// Link, change terms and unlink of a gym student's monthly fee (ADR-007). The
// plan and its recurring row are created together and the first fee is issued
// right after; if issuing fails the link is undone, so a link never exists
// without its first fee.
@Injectable()
export class GymRecurringBillingService {
  private readonly logger = new Logger(GymRecurringBillingService.name);

  constructor(
    private readonly recurring: GymRecurringBillingRepository,
    private readonly plans: StudentAccessPlanRepository,
    private readonly catalog: AcademiaAccessPlanRepository,
    private readonly clients: ClientsRepository,
    private readonly invoices: InvoicesService,
    private readonly clock: Clock,
  ) {}

  async linkWithBilling(
    input: LinkWithBillingInput,
  ): Promise<AssignAccessPlanResponseDTO> {
    const { owner, clientId } = input;
    const client = await this.ownedClient(owner, clientId);
    const plan = await this.availablePlan(owner, input.accessPlanId);
    const now = this.clock.now();
    const today = brasiliaDateKey(now);
    const terms = this.resolveTerms(input.billing, plan, today);
    if (!terms) return await this.assignWithoutBilling(client.id, plan, now);

    await this.assertNoActiveBilling(clientId);
    const account = await this.invoices.requireIssuingAccount(owner.ownerId);
    await this.invoices.resolveTaxId(clientId, input.billing.cpfCnpj);

    const linked = await this.recurring.createLink({
      plan: buildAssignment(plan, clientId, now),
      billing: { clientId, accessPlanId: plan.id, ...terms },
    });
    if (!linked) throw this.billingExists();

    const first = firstFeeOf(linked.billing.dueDay, today);
    try {
      const invoice = await this.invoices.issueRecurringFee({
        account,
        client,
        recurringBillingId: linked.billing.id,
        competence: first.competence,
        amountCents: linked.billing.amountCents,
        dueDate: first.dueDate,
      });
      return {
        plan: linked.plan,
        billing: toBillingView(linked.billing),
        firstInvoice: this.invoices.toResponse(invoice),
      };
    } catch (error) {
      await this.compensate(linked);
      throw error;
    }
  }

  async changeTerms(
    input: ChangeTermsInput,
  ): Promise<RecurringBillingResponseDTO> {
    const { owner, clientId } = input;
    await this.ownedClient(owner, clientId);
    const dueDay = this.optional(input.dueDay, parseDueDay);
    const amount = this.optional(input.amountCents, parseAmountCents);
    const current = await this.recurring.findActiveByClient(clientId);
    if (!current) throw this.billingNotFound();

    const change = await this.termsChange(owner, current, { dueDay, amount });
    if (Object.keys(change).length === 0) return toBillingView(current);
    const updated = await this.recurring.updateTerms(clientId, change);
    if (!updated) throw this.billingNotFound();
    return toBillingView(updated);
  }

  // Archives the active plan, ends the recurring row and cancels the open
  // fees due today or later; overdue fees stay owed (US-014 AC-1).
  async unlink(input: UnlinkInput): Promise<void> {
    const { owner, clientId } = input;
    await this.ownedClient(owner, clientId);
    const now = this.clock.now();
    const ended = await this.recurring.endLink(clientId, now);
    if (!ended) throw new CodedError(NO_PLAN, 404, 'student_has_no_plan');

    const failed = await this.invoices.cancelUpcomingFees({
      ownerId: owner.ownerId,
      clientId,
      todayKey: brasiliaDateKey(now),
    });
    if (failed > 0) {
      this.logger.warn(
        `unlink_fees_left_open clientId=${clientId} count=${failed}`,
      );
    }
  }

  // A plain re-assignment keeps an active recurring row, pointing it at the
  // new plan; the amount follows the plan price unless it is custom.
  async followPlanChange(plan: StudentAccessPlan): Promise<void> {
    const current = await this.recurring.findActiveByClient(plan.clientId);
    if (!current) return;
    await this.recurring.followPlan(plan.clientId, {
      accessPlanId: plan.accessPlanId,
      amountCents: effectiveAmountCents(
        current,
        priceToCents(plan.referencePrice),
      ),
    });
  }

  private async ownedClient(
    owner: BillingOwner,
    clientId: string,
  ): Promise<Client> {
    const client = await this.clients.getClientById(clientId);
    if (!client || !ownsClient(owner, client)) {
      throw new CodedError(STUDENT_NOT_FOUND, 404, 'student_not_found');
    }
    return client;
  }

  private async availablePlan(
    owner: BillingOwner,
    accessPlanId: string,
  ): Promise<AcademiaAccessPlan> {
    const plan = await this.catalog.findById(accessPlanId, owner.academiaId!);
    if (!plan || !plan.active) {
      throw new CodedError(PLAN_NOT_FOUND, 404, 'access_plan_not_found');
    }
    return plan;
  }

  // Null when there is nothing to bill: a free plan with no amount set.
  private resolveTerms(
    billing: BillingTermsInput,
    plan: AcademiaAccessPlan,
    today: string,
  ): RecurringTerms | null {
    const dueDay =
      this.optional(billing.dueDay, parseDueDay) ?? defaultDueDay(today);
    const override = this.optional(billing.amountCents, parseAmountCents);
    const price = priceToCents(plan.referencePrice);
    if (override === undefined && price <= 0) return null;

    const amountCents = override ?? parseAmountCents(price);
    return { dueDay, amountCents, customAmount: amountCents !== price };
  }

  private optional<T>(
    raw: unknown,
    parse: (value: unknown) => T,
  ): T | undefined {
    return raw === undefined || raw === null ? undefined : parse(raw);
  }

  private async assignWithoutBilling(
    clientId: string,
    plan: AcademiaAccessPlan,
    now: Date,
  ): Promise<AssignAccessPlanResponseDTO> {
    const created = await this.plans.create(
      buildAssignment(plan, clientId, now),
    );
    await this.plans.activate(clientId, created.id);
    const active = await this.plans.findById(created.id);
    return { plan: active!, billing: null, firstInvoice: null };
  }

  private async assertNoActiveBilling(clientId: string): Promise<void> {
    if (await this.recurring.findActiveByClient(clientId)) {
      throw this.billingExists();
    }
  }

  // What a PATCH changes: a given amount equal to the plan price follows the
  // plan again; any other amount is custom (UT-055).
  private async termsChange(
    owner: BillingOwner,
    current: GymRecurringBilling,
    given: { dueDay?: number; amount?: number },
  ): Promise<BillingTermsChange> {
    const change: BillingTermsChange = {};
    if (given.dueDay !== undefined) change.dueDay = given.dueDay;
    if (given.amount === undefined) return change;

    const plan = await this.catalog.findById(
      current.accessPlanId,
      owner.academiaId!,
    );
    change.amountCents = given.amount;
    change.customAmount =
      !plan || given.amount !== priceToCents(plan.referencePrice);
    return change;
  }

  // Undoes the link when the first fee could not be issued (ADR-007). A
  // failure here is a high-priority event: the student may be left with a
  // plan and recurring row but no fee, which the next issuer run repairs.
  private async compensate(linked: LinkedRows): Promise<void> {
    const clientId = linked.plan.clientId;
    try {
      await this.recurring.rollbackLink(linked);
      this.logger.warn(
        `first_fee_compensation clientId=${clientId} step=rolled_back`,
      );
    } catch (error) {
      this.logger.error(
        `first_fee_compensation clientId=${clientId} step=failed`,
      );
      Sentry.captureException(error, {
        level: 'fatal',
        tags: { flow: 'first_fee_compensation' },
        extra: { clientId },
      });
    }
  }

  private billingExists(): CodedError {
    return new CodedError(BILLING_EXISTS, 409, 'recurring_billing_exists');
  }

  private billingNotFound(): CodedError {
    return new CodedError(
      BILLING_NOT_FOUND,
      404,
      'recurring_billing_not_found',
    );
  }
}
