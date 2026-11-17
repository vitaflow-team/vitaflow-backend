import { InvoicesService } from '@/billing/invoices/invoices.service';
import { ownsClient } from '@/billing/owner/billingOwnerRules';
import { brasiliaDateKey } from '@/billing/shared/dates';
import { CodedError } from '@/common/errors/codedError';
import { GymRecurringBillingRepository } from '@/repositories/academia/gymRecurringBilling.repository';
import { StudentAccessPlanRepository } from '@/repositories/academia/studentAccessPlan.repository';
import { StudentTaxIdRepository } from '@/repositories/billing/studentTaxId.repository';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { Clock } from '@/scheduling/clock.service';
import { Injectable, Logger } from '@nestjs/common';
import { Client, GymRecurringBilling } from '@prisma/client';
import * as Sentry from '@sentry/node';
import type { ActivationResultResponseDTO } from './dto/activationResultResponse.Dto';
import type { EligibleStudentResponseDTO } from './dto/eligibleStudentResponse.Dto';
import { RECURRING_BILLING_LIMITS } from './recurringBillingLimits';
import {
  defaultDueDay,
  firstFeeOf,
  parseAmountCents,
  parseDueDay,
  priceToCents,
} from './recurringBillingRules';
import type { ActivationContext } from './types/activationContext';
import type { ActivateManyInput } from './types/activateManyInput';
import type { ActivationItem } from './types/activationItem';
import type { ActivationOutcome } from './types/activationOutcome';
import type { ValidatedActivationItem } from './types/validatedActivationItem';

const EMPTY_SELECTION = 'Selecione ao menos um aluno.';
const SELECTION_TOO_LARGE = `Selecione no máximo ${RECURRING_BILLING_LIMITS.bulkActivationMaxItems} alunos por vez.`;

// Bulk activation of recurring billing for students that were linked to a
// plan before this feature (US-015). Items are processed one at a time: a
// student that cannot be activated is skipped with its reason, never failing
// the rest.
@Injectable()
export class GymBillingActivationService {
  private readonly logger = new Logger(GymBillingActivationService.name);

  constructor(
    private readonly recurring: GymRecurringBillingRepository,
    private readonly plans: StudentAccessPlanRepository,
    private readonly taxIds: StudentTaxIdRepository,
    private readonly clients: ClientsRepository,
    private readonly invoices: InvoicesService,
    private readonly clock: Clock,
  ) {}

  async eligibleForActivation(
    academiaId: string,
  ): Promise<EligibleStudentResponseDTO[]> {
    const rows = await this.recurring.findEligible(academiaId);
    return rows.map((row) => ({
      clientId: row.clientId,
      name: row.name,
      planName: row.planName,
      amountCents: priceToCents(row.referencePrice),
      hasTaxId: row.hasTaxId,
    }));
  }

  async activateMany(
    input: ActivateManyInput,
  ): Promise<ActivationResultResponseDTO> {
    const today = brasiliaDateKey(this.clock.now());
    const items = this.validated(input.items, today);
    const account = await this.invoices.requireIssuingAccount(
      input.owner.ownerId,
    );

    const context = { owner: input.owner, account, today };
    const result: ActivationResultResponseDTO = { activated: [], skipped: [] };
    for (const item of items) {
      const outcome = await this.activateOne(context, item);
      if (outcome === 'activated') result.activated.push(item.clientId);
      else result.skipped.push({ clientId: item.clientId, reason: outcome });
    }
    return result;
  }

  private validated(
    items: ActivationItem[],
    today: string,
  ): ValidatedActivationItem[] {
    if (items.length === 0) {
      throw new CodedError(EMPTY_SELECTION, 400, 'empty_selection');
    }
    if (items.length > RECURRING_BILLING_LIMITS.bulkActivationMaxItems) {
      throw new CodedError(SELECTION_TOO_LARGE, 400, 'selection_too_large');
    }
    return items.map((item) => ({
      clientId: item.clientId,
      dueDay:
        item.dueDay === undefined || item.dueDay === null
          ? defaultDueDay(today)
          : parseDueDay(item.dueDay),
      amountCents:
        item.amountCents === undefined || item.amountCents === null
          ? null
          : parseAmountCents(item.amountCents),
    }));
  }

  private async activateOne(
    context: ActivationContext,
    item: ValidatedActivationItem,
  ): Promise<ActivationOutcome> {
    const client = await this.clients.getClientById(item.clientId);
    if (!client || !ownsClient(context.owner, client)) return 'no_active_plan';

    const plan = await this.plans.findActiveByClient(item.clientId);
    const price = plan ? priceToCents(plan.referencePrice) : 0;
    const amountCents = item.amountCents ?? price;
    if (!plan || amountCents <= 0) return 'no_active_plan';
    if (await this.recurring.findActiveByClient(item.clientId)) {
      return 'already_billing';
    }
    if (!(await this.taxIds.find(item.clientId))) return 'tax_id_missing';

    const billing = await this.recurring.createForActivePlan({
      clientId: item.clientId,
      accessPlanId: plan.accessPlanId,
      dueDay: item.dueDay,
      amountCents,
      customAmount: amountCents !== price,
    });
    if (!billing) return 'already_billing';
    return await this.issueFirstFee(context, client, billing);
  }

  private async issueFirstFee(
    context: ActivationContext,
    client: Client,
    billing: GymRecurringBilling,
  ): Promise<'activated' | 'gateway_failed'> {
    const first = firstFeeOf(billing.dueDay, context.today);
    try {
      await this.invoices.issueRecurringFee({
        account: context.account,
        client,
        recurringBillingId: billing.id,
        competence: first.competence,
        amountCents: billing.amountCents,
        dueDate: first.dueDate,
      });
      return 'activated';
    } catch (error) {
      await this.undoActivation(billing, error);
      return 'gateway_failed';
    }
  }

  // The first fee failed: the recurring row goes away, leaving the student
  // activatable again (US-015 EC-3).
  private async undoActivation(
    billing: GymRecurringBilling,
    cause: unknown,
  ): Promise<void> {
    const clientId = billing.clientId;
    this.logger.warn(
      `recurring_fee_failed clientId=${clientId} flow=activation`,
    );
    Sentry.captureException(cause, { extra: { clientId } });
    try {
      await this.recurring.deleteById(billing.id);
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
}
