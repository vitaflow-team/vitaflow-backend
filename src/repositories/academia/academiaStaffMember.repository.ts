import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { AcademiaStaffMember, Prisma } from '@prisma/client';

@Injectable()
export class AcademiaStaffMemberRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<AcademiaStaffMember | null> {
    return await this.prisma.academiaStaffMember.findUnique({
      where: { email },
    });
  }

  async findById(id: string): Promise<AcademiaStaffMember | null> {
    return await this.prisma.academiaStaffMember.findUnique({ where: { id } });
  }

  async create(
    academiaId: string,
    name: string,
    email: string,
  ): Promise<AcademiaStaffMember> {
    return await this.prisma.academiaStaffMember.create({
      data: { academiaId, name, email, passwordHash: null },
    });
  }

  async listByAcademia(academiaId: string): Promise<AcademiaStaffMember[]> {
    return await this.prisma.academiaStaffMember.findMany({
      where: { academiaId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setActive(
    id: string,
    academiaId: string,
    active: boolean,
  ): Promise<boolean> {
    const { count } = await this.prisma.academiaStaffMember.updateMany({
      where: { id, academiaId },
      data: { active },
    });
    return count === 1;
  }

  async activateWithToken(
    tokenId: string,
    staffMemberId: string,
    passwordHash: string,
  ): Promise<AcademiaStaffMember | null> {
    return await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.academiaStaffMemberToken.deleteMany({
        where: { id: tokenId, expiresAt: { gt: new Date() } },
      });
      if (count !== 1) {
        return null;
      }
      return await tx.academiaStaffMember.update({
        where: { id: staffMemberId },
        data: { passwordHash },
      });
    });
  }
}

export type { Prisma };
