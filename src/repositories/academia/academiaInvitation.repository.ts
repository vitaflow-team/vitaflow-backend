import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import {
  AcademiaInvitation,
  AcademiaInvitationKind,
  AcademiaInvitationStatus,
} from '@prisma/client';

export type AcademiaInvitationWithAcademia = AcademiaInvitation & {
  academia: { id: string; name: string };
};

@Injectable()
export class AcademiaInvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findPendingDuplicate(
    academiaId: string,
    email: string,
    kind: AcademiaInvitationKind,
  ): Promise<AcademiaInvitation | null> {
    return await this.prisma.academiaInvitation.findFirst({
      where: {
        academiaId,
        kind,
        status: AcademiaInvitationStatus.PENDING,
        email: { equals: email, mode: 'insensitive' },
      },
    });
  }

  async create(
    academiaId: string,
    email: string,
    kind: AcademiaInvitationKind,
    educatorId: string | null,
  ): Promise<AcademiaInvitation> {
    return await this.prisma.academiaInvitation.create({
      data: { academiaId, email, kind, educatorId },
    });
  }

  async findById(id: string): Promise<AcademiaInvitationWithAcademia | null> {
    return await this.prisma.academiaInvitation.findUnique({
      where: { id },
      include: { academia: { select: { id: true, name: true } } },
    });
  }

  async listSentByAcademia(
    academiaId: string,
  ): Promise<AcademiaInvitationWithAcademia[]> {
    return await this.prisma.academiaInvitation.findMany({
      where: { academiaId },
      include: { academia: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPendingForEducator(
    educatorId: string,
    email: string,
  ): Promise<AcademiaInvitationWithAcademia[]> {
    return await this.prisma.academiaInvitation.findMany({
      where: {
        kind: AcademiaInvitationKind.EMPLOYMENT,
        status: AcademiaInvitationStatus.PENDING,
        OR: [
          { educatorId },
          { educatorId: null, email: { equals: email, mode: 'insensitive' } },
        ],
      },
      include: { academia: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async backfillEducatorId(id: string, educatorId: string): Promise<void> {
    await this.prisma.academiaInvitation.updateMany({
      where: { id, educatorId: null },
      data: { educatorId },
    });
  }

  async transitionIfPendingForEducator(
    id: string,
    educatorId: string,
    email: string,
    status:
      | typeof AcademiaInvitationStatus.ACCEPTED
      | typeof AcademiaInvitationStatus.DECLINED,
  ): Promise<number> {
    const { count } = await this.prisma.academiaInvitation.updateMany({
      where: {
        id,
        kind: AcademiaInvitationKind.EMPLOYMENT,
        status: AcademiaInvitationStatus.PENDING,
        OR: [
          { educatorId },
          { educatorId: null, email: { equals: email, mode: 'insensitive' } },
        ],
      },
      data: { status, decidedAt: new Date(), educatorId },
    });
    return count;
  }

  async listPendingReceptionistInvitations(
    email: string,
  ): Promise<AcademiaInvitationWithAcademia[]> {
    return await this.prisma.academiaInvitation.findMany({
      where: {
        kind: AcademiaInvitationKind.RECEPTIONIST,
        status: AcademiaInvitationStatus.PENDING,
        email: { equals: email, mode: 'insensitive' },
      },
      include: { academia: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async transitionIfPendingReceptionist(
    id: string,
    email: string,
    status:
      | typeof AcademiaInvitationStatus.ACCEPTED
      | typeof AcademiaInvitationStatus.DECLINED,
  ): Promise<number> {
    const { count } = await this.prisma.academiaInvitation.updateMany({
      where: {
        id,
        kind: AcademiaInvitationKind.RECEPTIONIST,
        status: AcademiaInvitationStatus.PENDING,
        email: { equals: email, mode: 'insensitive' },
      },
      data: { status, decidedAt: new Date() },
    });
    return count;
  }

  async setStaffId(id: string, staffId: string): Promise<void> {
    await this.prisma.academiaInvitation.updateMany({
      where: { id },
      data: { staffId },
    });
  }

  async cancelIfPending(id: string, academiaId: string): Promise<number> {
    const { count } = await this.prisma.academiaInvitation.updateMany({
      where: { id, academiaId, status: AcademiaInvitationStatus.PENDING },
      data: {
        status: AcademiaInvitationStatus.CANCELLED,
        decidedAt: new Date(),
      },
    });
    return count;
  }
}
