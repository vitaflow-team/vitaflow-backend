import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { FitnessProfile, Prisma } from '@prisma/client';

export type FitnessProfileInput = Partial<
  Pick<
    Prisma.FitnessProfileUncheckedCreateInput,
    'sex' | 'restrictions' | 'equipment' | 'goal'
  >
>;

@Injectable()
export class FitnessProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<FitnessProfile | null> {
    return await this.prisma.fitnessProfile.findUnique({ where: { userId } });
  }

  async upsert(
    userId: string,
    data: FitnessProfileInput,
  ): Promise<FitnessProfile> {
    return await this.prisma.fitnessProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }
}
