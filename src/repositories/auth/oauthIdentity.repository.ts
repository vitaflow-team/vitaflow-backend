import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { OAuthIdentity } from '@prisma/client';

@Injectable()
export class OAuthIdentityRepository {
  constructor(private prisma: PrismaService) {}

  async findByProviderAccount(
    provider: string,
    providerAccountId: string,
  ): Promise<OAuthIdentity | null> {
    return await this.prisma.oAuthIdentity.findUnique({
      where: {
        provider_providerAccountId: { provider, providerAccountId },
      },
    });
  }

  async findByUserId(
    userId: string,
    provider: string,
  ): Promise<OAuthIdentity | null> {
    return await this.prisma.oAuthIdentity.findUnique({
      where: {
        provider_userId: { provider, userId },
      },
    });
  }

  async create(data: {
    provider: string;
    providerAccountId: string;
    userId: string;
  }): Promise<OAuthIdentity> {
    return await this.prisma.oAuthIdentity.create({ data });
  }
}
