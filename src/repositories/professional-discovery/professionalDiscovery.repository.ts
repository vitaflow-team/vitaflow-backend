import { PrismaService } from '@/database/prisma.service';
import { escapeLikePattern } from '@/utils/escapeLikePattern';
import { Injectable } from '@nestjs/common';
import {
  ConnectionRequest,
  ConnectionRequestStatus,
  Prisma,
  ProductType,
  ProfessionalProfile,
  Product,
  Users,
} from '@prisma/client';

export type ProfessionalWithProfile = Users & {
  product: Product | null;
  professionalProfile: ProfessionalProfile | null;
};

export type ConnectionRequestWithUser = ConnectionRequest & {
  user: Pick<Users, 'id' | 'name'>;
};

export type ConnectionRequestWithProfessional = ConnectionRequest & {
  professional: Pick<Users, 'id' | 'name'>;
};

export interface ProfessionalSearchFilter {
  type?: ProductType;
  specialty?: string;
  priceMax?: number;
  online?: boolean;
}

export interface UpdateProfileInput {
  bio?: string;
  specialty?: string;
  priceFrom?: number;
  attendsOnline?: boolean;
}

const PROFESSIONAL_TYPES: ProductType[] = [
  ProductType.NUTRITIONIST,
  ProductType.PHYSICAL_EDUCATOR,
];

@Injectable()
export class ProfessionalDiscoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    filter: ProfessionalSearchFilter,
  ): Promise<ProfessionalWithProfile[]> {
    const profileFilter: Prisma.ProfessionalProfileWhereInput = {};
    if (filter.priceMax !== undefined) {
      profileFilter.priceFrom = { lte: filter.priceMax };
    }
    if (filter.online !== undefined) {
      profileFilter.attendsOnline = filter.online;
    }

    const where: Prisma.UsersWhereInput = {
      product: { type: filter.type ?? { in: PROFESSIONAL_TYPES } },
      ...(Object.keys(profileFilter).length
        ? { professionalProfile: profileFilter }
        : {}),
      ...(filter.specialty
        ? {
            OR: [
              {
                name: {
                  contains: escapeLikePattern(filter.specialty),
                  mode: 'insensitive',
                },
              },
              {
                professionalProfile: {
                  specialty: {
                    contains: escapeLikePattern(filter.specialty),
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };

    return await this.prisma.users.findMany({
      where,
      include: { product: true, professionalProfile: true },
      orderBy: { name: 'asc' },
    });
  }

  async findProfessionalById(
    professionalId: string,
  ): Promise<ProfessionalWithProfile | null> {
    return await this.prisma.users.findUnique({
      where: { id: professionalId },
      include: { product: true, professionalProfile: true },
    });
  }

  async upsertProfile(
    professionalId: string,
    data: UpdateProfileInput,
  ): Promise<ProfessionalProfile> {
    return await this.prisma.professionalProfile.upsert({
      where: { userId: professionalId },
      create: { userId: professionalId, ...data },
      update: data,
    });
  }

  async findPendingRequest(
    userId: string,
    professionalId: string,
  ): Promise<ConnectionRequest | null> {
    return await this.prisma.connectionRequest.findFirst({
      where: {
        userId,
        professionalId,
        status: ConnectionRequestStatus.PENDING,
      },
    });
  }

  async createRequest(
    userId: string,
    professionalId: string,
  ): Promise<ConnectionRequest> {
    return await this.prisma.connectionRequest.create({
      data: { userId, professionalId },
    });
  }

  async findRequestById(id: string): Promise<ConnectionRequest | null> {
    return await this.prisma.connectionRequest.findUnique({ where: { id } });
  }

  async listByUser(
    userId: string,
  ): Promise<ConnectionRequestWithProfessional[]> {
    return await this.prisma.connectionRequest.findMany({
      where: { userId },
      include: { professional: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listIncomingPending(
    professionalId: string,
  ): Promise<ConnectionRequestWithUser[]> {
    return await this.prisma.connectionRequest.findMany({
      where: {
        professionalId,
        status: ConnectionRequestStatus.PENDING,
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Conditional transition: only succeeds (count 1) when the request is
  // still PENDING and addressed to this professional — the single source of
  // truth for "exactly one of two concurrent accept attempts ever succeeds"
  // (IT-006), the same conditional-updateMany idiom UserRepository.consumeToken
  // uses for one-time token consumption.
  async transitionIfPending(
    id: string,
    professionalId: string,
    status:
      | typeof ConnectionRequestStatus.ACCEPTED
      | typeof ConnectionRequestStatus.DECLINED,
  ): Promise<number> {
    const { count } = await this.prisma.connectionRequest.updateMany({
      where: { id, professionalId, status: ConnectionRequestStatus.PENDING },
      data: { status, decidedAt: new Date() },
    });
    return count;
  }
}
