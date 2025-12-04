import { PrismaService } from '@/database/prisma.service';
import { ProfileAddressDTO } from '@/users/profile/profileAddress.Dto';
import { Injectable } from '@nestjs/common';
import { Prisma, Users } from '@prisma/client';

@Injectable()
export class UserRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.UsersCreateInput): Promise<Users> {
    return await this.prisma.users.create({
      data,
    });
  }

  async findUnique(where: Prisma.UsersWhereUniqueInput): Promise<Users | null> {
    return await this.prisma.users.findUnique({
      where,
    });
  }

  async findByEmail(
    where: Prisma.UsersWhereUniqueInput,
  ): Promise<Users | null> {
    return await this.prisma.users.findUnique({
      where,
    });
  }

  async activateUser(id: string): Promise<Users> {
    return await this.prisma.users.update({
      where: { id },
      data: { active: true },
    });
  }

  async updatePassword(id: string, password: string): Promise<Users> {
    return await this.prisma.users.update({
      where: { id },
      data: { password },
    });
  }

  async updateUserProfile(
    id: string,
    userData: Prisma.UsersUpdateInput,
    address?: ProfileAddressDTO,
  ): Promise<Users & { address: ProfileAddressDTO | null }> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.users.update({
        where: { id },
        data: {
          name: userData.name,
          birthDate: userData.birthDate,
          avatar: userData.avatar,
          phone: userData.phone,
        },
      });

      if (address) {
        await tx.userAddress.upsert({
          where: { userId: id },
          update: address,
          create: { userId: id, ...address },
        });
      }

      return { ...user, address: address ?? null };
    });
  }
}
