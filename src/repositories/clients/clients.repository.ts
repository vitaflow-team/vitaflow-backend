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

  async update(id: string, data: Prisma.ClientUpdateInput): Promise<Client> {
    return await this.prisma.client.update({
      where: {
        id,
      },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.client.delete({
      where: {
        id,
      },
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

  async getClientById(id: string): Promise<Client | null> {
    return await this.prisma.client.findUnique({
      where: {
        id,
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

  async setAllClientUser(userId: string, email: string): Promise<void> {
    await this.prisma.client.updateMany({
      where: {
        email,
      },
      data: {
        userId,
      },
    });
  }
}
