import { Clock } from '@/scheduling/clock.service';
import { CheckInRepository } from '@/repositories/academia/checkIn.repository';
import { StudentAccessPlanService } from '@/academia/checkin/studentAccessPlan.service';
import { Injectable } from '@nestjs/common';
import { CheckIn, CheckInSource } from '@prisma/client';
import { CheckInNoticeService } from './checkinNotice.service';
import type { ReceptionistCheckInResponseDTO } from './dto/receptionistCheckInResponse.Dto';

@Injectable()
export class CheckInService {
  constructor(
    private readonly checkIns: CheckInRepository,
    private readonly accessPlans: StudentAccessPlanService,
    private readonly clock: Clock,
    private readonly notices: CheckInNoticeService,
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

  // The receptionist's confirmation: the check-in is recorded first and
  // never held up; the notice only says whether the student should see the
  // administration (ADR-005). The self check-in keeps returning the full row.
  async registerByReceptionist(
    clientId: string,
    staff: { id: string; academiaId: string },
  ): Promise<ReceptionistCheckInResponseDTO> {
    const checkIn = await this.register(clientId, 'RECEPTIONIST', staff.id);
    const notice = await this.notices.noticeFor(clientId, staff.academiaId);
    return { id: checkIn.id, createdAt: checkIn.createdAt, notice };
  }
}
