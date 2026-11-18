import { PrismaService } from '@/database/prisma.service';
import { PushSubscriptionRecord } from '@/push/types/pushSubscriptionRecord';
import { Injectable } from '@nestjs/common';
import { PushDevice, PushDeviceStatus } from '@prisma/client';

export interface PushDeviceInput extends PushSubscriptionRecord {
  userAgent?: string | null;
}

@Injectable()
export class PushDeviceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByEndpoint(endpoint: string): Promise<PushDevice | null> {
    return await this.prisma.pushDevice.findUnique({ where: { endpoint } });
  }

  async findActiveByUser(userId: string): Promise<PushDevice[]> {
    return await this.prisma.pushDevice.findMany({
      where: { userId, status: 'ACTIVE' },
    });
  }

  async findByUserOldestFirst(userId: string): Promise<PushDevice[]> {
    return await this.prisma.pushDevice.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // `endpoint` is globally unique, so upserting by it also transfers a device
  // from another account to this one (push-notifications ADR-009).
  async upsertActive(
    userId: string,
    input: PushDeviceInput,
  ): Promise<PushDevice> {
    const data = {
      userId,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
      status: PushDeviceStatus.ACTIVE,
    };
    return await this.prisma.pushDevice.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...data },
      update: data,
    });
  }

  async deleteByEndpoint(endpoint: string): Promise<number> {
    const { count } = await this.prisma.pushDevice.deleteMany({
      where: { endpoint },
    });
    return count;
  }

  async deleteByEndpointForUser(
    userId: string,
    endpoint: string,
  ): Promise<number> {
    const { count } = await this.prisma.pushDevice.deleteMany({
      where: { userId, endpoint },
    });
    return count;
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pushDevice.deleteMany({ where: { id: { in: ids } } });
  }

  async changeStatusForUser(
    userId: string,
    endpoint: string,
    from: PushDeviceStatus,
    to: PushDeviceStatus,
  ): Promise<number> {
    const { count } = await this.prisma.pushDevice.updateMany({
      where: { userId, endpoint, status: from },
      data: { status: to },
    });
    return count;
  }

  async refreshKeysForUser(
    userId: string,
    endpoint: string,
    keys: Pick<PushSubscriptionRecord, 'p256dh' | 'auth'>,
  ): Promise<void> {
    await this.prisma.pushDevice.updateMany({
      where: { userId, endpoint },
      data: keys,
    });
  }
}
