import { Injectable } from '@nestjs/common';
import { StudentAccessPlanService } from '../checkin/studentAccessPlan.service';
import type { AssignAccessPlanResponseDTO } from './dto/assignAccessPlanResponse.Dto';
import { GymRecurringBillingService } from './gymRecurringBilling.service';
import type { AssignPlanInput } from './types/assignPlanInput';
import type { UnlinkInput } from './types/unlinkInput';

// The owner's entry points for linking a student to an access plan: with fee
// terms the link also starts the monthly billing; without them it is the
// plain assignment, which keeps an active recurring row in step with the new
// plan. Kept apart from StudentAccessPlanService so the check-in and mirror
// modules, which only read plan status, do not depend on billing.
@Injectable()
export class AccessPlanLinkService {
  constructor(
    private readonly accessPlans: StudentAccessPlanService,
    private readonly billing: GymRecurringBillingService,
  ) {}

  async assign(input: AssignPlanInput): Promise<AssignAccessPlanResponseDTO> {
    if (input.billing) {
      return await this.billing.linkWithBilling({
        ...input,
        billing: input.billing,
      });
    }
    const plan = await this.accessPlans.assign(
      input.clientId,
      input.accessPlanId,
    );
    await this.billing.followPlanChange(plan);
    return { plan, billing: null, firstInvoice: null };
  }

  async unlink(input: UnlinkInput): Promise<void> {
    await this.billing.unlink(input);
  }
}
