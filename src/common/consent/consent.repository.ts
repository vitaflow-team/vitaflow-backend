import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { ConsentFeature, FeatureConsent } from '@prisma/client';

@Injectable()
export class ConsentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    userId: string,
    feature: ConsentFeature,
  ): Promise<FeatureConsent | null> {
    return await this.prisma.featureConsent.findUnique({
      where: { userId_feature: { userId, feature } },
    });
  }

  // Idempotent: granting an already-granted consent is a no-op success,
  // not a conflict — a redundant call from the client is expected (AC-2)
  // rather than exceptional.
  async create(
    userId: string,
    feature: ConsentFeature,
  ): Promise<FeatureConsent> {
    return await this.prisma.featureConsent.upsert({
      where: { userId_feature: { userId, feature } },
      create: { userId, feature },
      update: {},
    });
  }
}
