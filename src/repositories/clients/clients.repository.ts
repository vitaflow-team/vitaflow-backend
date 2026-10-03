import { PrismaService } from '@/database/prisma.service';
import { escapeLikePattern } from '@/utils/escapeLikePattern';
import { Injectable } from '@nestjs/common';
import { Client, Prisma, ProductType } from '@prisma/client';

export type ClientWithLatestAssessment = Client & {
  assessments: { assessedOn: Date }[];
};

@Injectable()
export class ClientsRepository {
  constructor(private readonly prisma: PrismaService) {}

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
    return await this.prisma.client.findFirst({
      where: {
        email: { equals: escapeLikePattern(email), mode: 'insensitive' },
        professionalId,
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
      orderBy: {
        name: 'asc',
      },
    });
  }

  async countByProfessionalId(professionalId: string): Promise<number> {
    return await this.prisma.client.count({
      where: {
        professionalId,
      },
    });
  }

  // The user's linked professional of a given type — the "accepted
  // relationship" the Professional Mirror reads (an existing Client row,
  // whichever flow created it). Most recent wins if more than one exists.
  async findByUserAndProfessionalType(
    userId: string,
    type: ProductType,
  ): Promise<Client | null> {
    return await this.prisma.client.findFirst({
      where: {
        userId,
        professional: { product: { type } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Whether a real, linked (user, professional) relationship exists — the
  // eligibility check Messages reuses rather than reimplementing (US-004).
  // An accepted ConnectionRequest from Professional Discovery always
  // produces exactly this kind of row via ClientRegisterService, so
  // checking it alone also correctly covers that case without a second
  // read against ConnectionRequest.
  async findByUserAndProfessional(
    userId: string,
    professionalId: string,
  ): Promise<Client | null> {
    return await this.prisma.client.findFirst({
      where: { userId, professionalId },
    });
  }

  // A student record only if it belongs to this professional: another
  // professional's id resolves to null, exactly like an id that does not exist.
  async findOwnedById(
    id: string,
    professionalId: string,
  ): Promise<Client | null> {
    return await this.prisma.client.findFirst({
      where: { id, professionalId },
    });
  }

  // The records among `ids` that belong to this professional, ids unique.
  async findOwnedByIds(
    ids: string[],
    professionalId: string,
  ): Promise<Client[]> {
    return await this.prisma.client.findMany({
      where: { id: { in: ids }, professionalId },
    });
  }

  // Every student of the professional with the date of the latest assessment,
  // in one query. Search, ordering and paging run over this whole list.
  async findAllWithLatestAssessment(
    professionalId: string,
  ): Promise<ClientWithLatestAssessment[]> {
    return await this.prisma.client.findMany({
      where: { professionalId },
      include: {
        assessments: {
          select: { assessedOn: true },
          orderBy: { assessedOn: 'desc' },
          take: 1,
        },
      },
    });
  }

  async setAllClientUser(userId: string, email: string): Promise<void> {
    await this.prisma.client.updateMany({
      where: {
        email: { equals: escapeLikePattern(email), mode: 'insensitive' },
      },
      data: {
        userId,
      },
    });
  }
}
