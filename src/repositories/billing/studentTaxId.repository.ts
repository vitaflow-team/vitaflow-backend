import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { StudentTaxId } from '@prisma/client';

@Injectable()
export class StudentTaxIdRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(clientId: string): Promise<StudentTaxId | null> {
    return await this.prisma.studentTaxId.findUnique({ where: { clientId } });
  }

  async upsert(clientId: string, ciphertext: string): Promise<StudentTaxId> {
    return await this.prisma.studentTaxId.upsert({
      where: { clientId },
      create: { clientId, ciphertext },
      update: { ciphertext },
    });
  }
}
