import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { ClientNutritionProfile } from '@prisma/client';

export interface ClientNutritionProfileInput {
  goal: string;
  restrictions: string;
  targetCalories: number | null;
  mealsPerDay: number;
}

// Minimal per-Client AI-generation intake record (PRD ADR-007) — read for
// pre-fill at the start of a later intake, upserted once generation
// completes. No other feature reads or writes this model.
@Injectable()
export class ClientNutritionProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByClientId(
    clientId: string,
  ): Promise<ClientNutritionProfile | null> {
    return await this.prisma.clientNutritionProfile.findUnique({
      where: { clientId },
    });
  }

  async upsert(
    clientId: string,
    data: ClientNutritionProfileInput,
  ): Promise<ClientNutritionProfile> {
    return await this.prisma.clientNutritionProfile.upsert({
      where: { clientId },
      create: { clientId, ...data },
      update: data,
    });
  }
}
