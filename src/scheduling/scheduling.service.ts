import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { SchedulingRepository } from '@/repositories/scheduling/scheduling.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { NotificationsService } from '@/notifications/notifications.service';
import { AppError } from '@/utils/app.erro';
import { Injectable } from '@nestjs/common';
import { Slot } from '@prisma/client';
import { Clock } from './clock.service';
import { BookSlotDto } from './dto/bookSlot.Dto';
import { PublishAvailabilityDto } from './dto/publishAvailability.Dto';
import { SetOnlineLinkDto } from './dto/setOnlineLink.Dto';
import { generateSlotsForWindow } from './slotGeneration.util';
import { AvailabilityWindowEntity } from './availabilityWindow.entity';
import { SlotEntity, UpcomingSlotEntity } from './slot.entity';
import { appUrl, formatDateTime } from './schedulingFormat.util';

const END_BEFORE_START = 'O horário final deve ser depois do horário inicial.';
const WINDOW_NOT_FOUND = 'Janela de disponibilidade não encontrada.';
const SLOT_NOT_FOUND = 'Horário não encontrado.';
const NOT_ELIGIBLE =
  'Você precisa ter um vínculo ativo com este profissional para agendar.';
const SLOT_JUST_TAKEN =
  'Este horário acabou de ser reservado por outra pessoa.';
const CANCEL_NOT_OWNED = 'Você não tem permissão para cancelar este horário.';
const CANCEL_IN_PAST = 'Não é possível cancelar uma sessão que já aconteceu.';
const CANCEL_NOT_BOOKED = 'Este horário não está reservado.';
const LINK_NOT_OWNED =
  'Você não tem permissão para definir o link deste horário.';

// Left to the TechSpec/implementer per the PRD's Open Questions (research
// found 1–24h all common); a standard cancellation needs at least this much
// notice to avoid the "late" notification copy — never blocked either way.
const MIN_CANCELLATION_NOTICE_HOURS = 4;
const HOUR_MS = 60 * 60 * 1000;

function toSlotEntity(slot: Slot): SlotEntity {
  return {
    id: slot.id,
    professionalId: slot.professionalId,
    startAt: slot.startAt,
    endAt: slot.endAt,
    status: slot.status,
    type: slot.type,
    onlineLink: slot.onlineLink,
  };
}

@Injectable()
export class SchedulingService {
  constructor(
    private readonly scheduling: SchedulingRepository,
    private readonly clients: ClientsRepository,
    private readonly users: UserRepository,
    private readonly notifications: NotificationsService,
    private readonly clock: Clock,
  ) {}

  // US-001: publishes a recurring window and immediately expands it into
  // concrete OPEN slots for the rolling window ahead (TechSpec Data Flow).
  async publishAvailability(
    professionalId: string,
    dto: PublishAvailabilityDto,
  ): Promise<AvailabilityWindowEntity> {
    if (dto.endMinute <= dto.startMinute) {
      throw new AppError(END_BEFORE_START, 400);
    }

    const window = await this.scheduling.createWindow(
      professionalId,
      dto.dayOfWeek,
      dto.startMinute,
      dto.endMinute,
      dto.sessionDurationMinutes,
    );

    const slots = generateSlotsForWindow(window, this.clock.now());
    await this.scheduling.createSlots(slots);

    return window;
  }

  // US-002: only future OPEN slots generated from this window are removed;
  // a BOOKED slot survives untouched (EC-1) since it's deleted by id/status,
  // never cascaded from the window row itself.
  async removeAvailability(
    professionalId: string,
    windowId: string,
  ): Promise<void> {
    const window = await this.scheduling.findWindowById(windowId);
    if (!window || window.professionalId !== professionalId) {
      throw new AppError(WINDOW_NOT_FOUND, 404);
    }

    await this.scheduling.deleteFutureOpenSlotsByWindow(
      windowId,
      this.clock.now(),
    );
    await this.scheduling.deleteWindow(windowId);
  }

  // The professional's own published windows — needed by the availability
  // grid to show current state, not just accept new windows blindly.
  async listAvailability(
    professionalId: string,
  ): Promise<AvailabilityWindowEntity[]> {
    return await this.scheduling.findWindowsByProfessional(professionalId);
  }

  // US-005: browsing a professional's open slots needs no relationship
  // check — eligibility is only enforced at the moment of booking (US-006).
  async listOpenSlots(
    professionalId: string,
    from: Date,
    to: Date,
  ): Promise<SlotEntity[]> {
    const slots = await this.scheduling.findOpenSlots(professionalId, from, to);
    return slots.map(toSlotEntity);
  }

  // US-006: the eligibility check is resolved before the atomic claim is
  // ever attempted (UT-013) — reusing ClientsRepository.findByUserAndProfessional,
  // the exact same shared check Messages (US-004) already established.
  async bookSlot(
    userId: string,
    slotId: string,
    dto: BookSlotDto,
  ): Promise<SlotEntity> {
    const slot = await this.scheduling.findSlotById(slotId);
    if (!slot) {
      throw new AppError(SLOT_NOT_FOUND, 404);
    }

    const eligible = await this.clients.findByUserAndProfessional(
      userId,
      slot.professionalId,
    );
    if (!eligible) {
      throw new AppError(NOT_ELIGIBLE, 403);
    }

    const claimed = await this.scheduling.claimSlot(slotId, userId, dto.type);
    if (claimed === 0) {
      throw new AppError(SLOT_JUST_TAKEN, 409);
    }

    const booked = await this.scheduling.findSlotById(slotId);
    const user = await this.users.findUnique({ id: userId });
    await this.notifications.create(
      slot.professionalId,
      'CONSULTATION_REMINDER',
      `Nova sessão agendada por ${user?.name ?? 'alguém'} em ${formatDateTime(slot.startAt)}.`,
      appUrl('/restrict/scheduling'),
    );

    return toSlotEntity(booked!);
  }

  // US-004/US-008: either party cancels; a late cancellation still
  // succeeds (no block, no penalty), only the notification copy differs
  // (UT-008). Reopens the slot for others to book (US-004.AC-1).
  async cancelSlot(actorId: string, slotId: string): Promise<void> {
    const slot = await this.scheduling.findSlotById(slotId);
    if (!slot) {
      throw new AppError(SLOT_NOT_FOUND, 404);
    }
    if (slot.professionalId !== actorId && slot.userId !== actorId) {
      throw new AppError(CANCEL_NOT_OWNED, 403);
    }
    if (slot.status !== 'BOOKED') {
      throw new AppError(CANCEL_NOT_BOOKED, 409);
    }

    const now = this.clock.now();
    if (slot.startAt <= now) {
      throw new AppError(CANCEL_IN_PAST, 400);
    }

    const isLate =
      slot.startAt.getTime() - now.getTime() <
      MIN_CANCELLATION_NOTICE_HOURS * HOUR_MS;

    await this.scheduling.reopenSlot(slotId);

    const recipientId =
      actorId === slot.professionalId ? slot.userId : slot.professionalId;
    if (recipientId) {
      const message = isLate
        ? `Sua sessão de ${formatDateTime(slot.startAt)} foi cancelada em cima da hora.`
        : `Sua sessão de ${formatDateTime(slot.startAt)} foi cancelada.`;
      await this.notifications.create(
        recipientId,
        'CONSULTATION_REMINDER',
        message,
        appUrl('/restrict/scheduling'),
      );
    }
  }

  // ADR-001: the link is stored and returned exactly as given — no
  // well-formedness validation of any kind.
  async setOnlineLink(
    professionalId: string,
    slotId: string,
    dto: SetOnlineLinkDto,
  ): Promise<SlotEntity> {
    const slot = await this.scheduling.findSlotById(slotId);
    if (!slot) {
      throw new AppError(SLOT_NOT_FOUND, 404);
    }
    if (slot.professionalId !== professionalId) {
      throw new AppError(LINK_NOT_OWNED, 403);
    }

    const updated = await this.scheduling.setOnlineLink(slotId, dto.link);
    return toSlotEntity(updated);
  }

  // US-003/US-007: scoped correctly whether the caller is a professional or
  // a user — findUpcomingForActor matches either role in one query.
  async listUpcoming(actorId: string): Promise<UpcomingSlotEntity[]> {
    const slots = await this.scheduling.findUpcomingForActor(
      actorId,
      this.clock.now(),
    );

    return slots.map((slot) => {
      const isActorProfessional = slot.professionalId === actorId;
      // A BOOKED slot always has a userId, so `slot.user` is always
      // populated here despite the relation's nullable type.
      const counterpart = isActorProfessional ? slot.user! : slot.professional;
      return { ...toSlotEntity(slot), counterpart };
    });
  }
}
