import { Clock } from '@/scheduling/clock.service';
import { CheckInRepository } from '@/repositories/academia/checkIn.repository';
import { StudentAccessPlanService } from '@/academia/checkin/studentAccessPlan.service';
import { Injectable } from '@nestjs/common';
import { CheckIn, CheckInSource } from '@prisma/client';

@Injectable()
export class CheckInService {
  constructor(
    private readonly checkIns: CheckInRepository,
    private readonly accessPlans: StudentAccessPlanService,
    private readonly clock: Clock,
  ) {}

  // Always creates the row (PRD ADR-002): planValidAtCheckIn is a write-time
  // snapshot (ADR-006), never a gate. NO_PLAN/VALID both snapshot true;
  // EXPIRED/EXHAUSTED snapshot false.
  async register(
    clientId: string,
    source: CheckInSource,
    registeredByStaffId?: string,
  ): Promise<CheckIn> {
    const { status } = await this.accessPlans.currentForClient(
      clientId,
      this.clock.now(),
    );
    const planValidAtCheckIn = status === 'NO_PLAN' || status === 'VALID';

    return await this.checkIns.create({
      clientId,
      source,
      registeredByStaffId: registeredByStaffId ?? null,
      planValidAtCheckIn,
    });
  }
}
