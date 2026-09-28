import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma, UsersToken } from '@prisma/client';

@Injectable()
export class UserTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Deletes the user's tokens of the same type and creates the new one in a
  // single transaction, so two tokens of one type are never live at once.
  async replace(
    data: Prisma.UsersTokenUncheckedCreateInput,
  ): Promise<UsersToken> {
    const [, token] = await this.prisma.$transaction([
      this.prisma.usersToken.deleteMany({
        where: { userID: data.userID, type: data.type },
      }),
      this.prisma.usersToken.create({ data }),
    ]);

    return token;
  }

  async findByHash(tokenHash: string): Promise<UsersToken | null> {
    return await this.prisma.usersToken.findUnique({
      where: { tokenHash },
    });
  }

  async deleteById(id: string): Promise<null> {
    await this.prisma.usersToken.deleteMany({
      where: { id },
    });

    return null;
  }

  async deleteAll(where: Prisma.UsersTokenWhereInput): Promise<null> {
    await this.prisma.usersToken.deleteMany({
      where,
    });

    return null;
  }
}
