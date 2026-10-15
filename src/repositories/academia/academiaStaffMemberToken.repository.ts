import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { AcademiaStaffMemberToken } from '@prisma/client';

@Injectable()
export class AcademiaStaffMemberTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async replace(
    staffMemberId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<AcademiaStaffMemberToken> {
    const [, token] = await this.prisma.$transaction([
      this.prisma.academiaStaffMemberToken.deleteMany({
        where: { staffMemberId },
      }),
      this.prisma.academiaStaffMemberToken.create({
        data: { staffMemberId, tokenHash, expiresAt },
      }),
    ]);
    return token;
  }

  async findByHash(
    tokenHash: string,
  ): Promise<AcademiaStaffMemberToken | null> {
    return await this.prisma.academiaStaffMemberToken.findUnique({
      where: { tokenHash },
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.academiaStaffMemberToken.deleteMany({ where: { id } });
  }
}
