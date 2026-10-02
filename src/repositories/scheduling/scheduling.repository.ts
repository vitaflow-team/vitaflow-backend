import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { AvailabilityWindow, SessionType, Slot } from '@prisma/client';
import { GeneratedSlot } from '@/scheduling/slotGeneration.util';

export type SlotWithParticipants = Slot & {
  user: { id: string; name: string } | null;
  professional: { id: string; name: string };
};

@Injectable()
export class SchedulingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createWindow(
    professionalId: string,
    dayOfWeek: number,
    startMinute: number,
    endMinute: number,
    sessionDurationMinutes: number,
  ): Promise<AvailabilityWindow> {
    return await this.prisma.availabilityWindow.create({
      data: {
        professionalId,
        dayOfWeek,
        startMinute,
        endMinute,
        sessionDurationMinutes,
      },
    });
  }

  async findWindowById(id: string): Promise<AvailabilityWindow | null> {
    return await this.prisma.availabilityWindow.findUnique({ where: { id } });
  }

  async findWindowsByProfessional(
    professionalId: string,
  ): Promise<AvailabilityWindow[]> {
    return await this.prisma.availabilityWindow.findMany({
      where: { professionalId },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    });
  }

  async deleteWindow(id: string): Promise<void> {
    await this.prisma.availabilityWindow.delete({ where: { id } });
  }

  // `skipDuplicates` makes this idempotent against the @@unique constraint:
  // re-running generation for an already-covered date never errors and
  // never touches the existing row (TechSpec Data Models).
  async createSlots(slots: GeneratedSlot[]): Promise<number> {
    if (slots.length === 0) return 0;
    const result = await this.prisma.slot.createMany({
      data: slots,
      skipDuplicates: true,
    });
    return result.count;
  }

  // Only OPEN slots from this window, still in the future — a BOOKED slot
  // originally generated from this window is never touched (US-002.AC-1/
  // AC-2, EC-1).
  async deleteFutureOpenSlotsByWindow(
    windowId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.slot.deleteMany({
      where: {
        availabilityWindowId: windowId,
        status: 'OPEN',
        startAt: { gt: now },
      },
    });
  }

  async findOpenSlots(
    professionalId: string,
    from: Date,
    to: Date,
  ): Promise<Slot[]> {
    return await this.prisma.slot.findMany({
      where: {
        professionalId,
        status: 'OPEN',
        startAt: { gte: from, lte: to },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  async findSlotById(id: string): Promise<Slot | null> {
    return await this.prisma.slot.findUnique({ where: { id } });
  }

  // The atomic conditional claim (ADR-002): an update scoped to status
  // OPEN, never a create-then-check. A returned count of 0 means someone
  // else won the race — the caller maps that to the 409 "just taken" path.
  async claimSlot(
    slotId: string,
    userId: string,
    type: SessionType,
  ): Promise<number> {
    const result = await this.prisma.slot.updateMany({
      where: { id: slotId, status: 'OPEN' },
      data: { status: 'BOOKED', userId, type },
    });
    return result.count;
  }

  // Resets every booking-specific field, not just status/userId — the next
  // person to book this slot chooses their own type, and a stale online
  // link from the canceled booking must not leak into the next one.
  async reopenSlot(slotId: string): Promise<void> {
    await this.prisma.slot.update({
      where: { id: slotId },
      data: {
        status: 'OPEN',
        userId: null,
        type: null,
        onlineLink: null,
        reminderSentAt: null,
      },
    });
  }

  async setOnlineLink(slotId: string, link: string): Promise<Slot> {
    return await this.prisma.slot.update({
      where: { id: slotId },
      data: { onlineLink: link },
    });
  }

  async findUpcomingForActor(
    actorId: string,
    now: Date,
  ): Promise<SlotWithParticipants[]> {
    return await this.prisma.slot.findMany({
      where: {
        status: 'BOOKED',
        startAt: { gte: now },
        OR: [{ professionalId: actorId }, { userId: actorId }],
      },
      include: {
        user: { select: { id: true, name: true } },
        professional: { select: { id: true, name: true } },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  async findDueForReminder(
    windowStart: Date,
    windowEnd: Date,
  ): Promise<SlotWithParticipants[]> {
    return await this.prisma.slot.findMany({
      where: {
        status: 'BOOKED',
        startAt: { gte: windowStart, lte: windowEnd },
        reminderSentAt: null,
      },
      include: {
        user: { select: { id: true, name: true } },
        professional: { select: { id: true, name: true } },
      },
    });
  }

  // The atomic claim that prevents a duplicate reminder (TechSpec Known
  // Risks): scoped to reminderSentAt: null, exactly like claimSlot's
  // status: OPEN scoping prevents a double booking.
  async claimReminder(slotId: string, sentAt: Date): Promise<number> {
    const result = await this.prisma.slot.updateMany({
      where: { id: slotId, reminderSentAt: null },
      data: { reminderSentAt: sentAt },
    });
    return result.count;
  }
}
