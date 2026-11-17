import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import type { NewBackofficeAccessLog } from './types/newBackofficeAccessLog';

// Write-only trail of who opened a sensitive backoffice list (ADR-010).
@Injectable()
export class BackofficeAccessLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewBackofficeAccessLog): Promise<void> {
    await this.prisma.backofficeAccessLog.create({ data });
  }
}
