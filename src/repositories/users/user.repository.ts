import { PrismaService } from '@/database/prisma.service';
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

  async findByEmail(
    where: Prisma.UsersWhereUniqueInput,
  ): Promise<Users | null> {
    return await this.prisma.users.findUnique({
      where,
    });
  }
}
