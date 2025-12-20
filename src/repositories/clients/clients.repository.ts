import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Client, Prisma } from '@prisma/client';

@Injectable()
export class ClientsRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.ClientCreateInput): Promise<Client> {
    return await this.prisma.client.create({
      data,
    });
  }

  async findByEmailAndProfessionalId(
    email: string,
    professionalId: string,
  ): Promise<Client | null> {
    return await this.prisma.client.findUnique({
      where: {
        email_professionalId: {
          email,
          professionalId,
        },
      },
    });
  }

  async getAllByProfessionalId(professionalId: string): Promise<Client[]> {
    return await this.prisma.client.findMany({
      where: {
        professionalId,
      },
    });
  }
}
