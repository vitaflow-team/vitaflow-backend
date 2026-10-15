import { PrismaService } from '@/database/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Academia, ProductType } from '@prisma/client';

@Injectable()
export class AcademiaProvisioningService {
  private readonly logger = new Logger(AcademiaProvisioningService.name);

  constructor(private readonly prisma: PrismaService) {}

  async provisionForOwner(ownerId: string): Promise<Academia | null> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Users" WHERE "id" = ${ownerId} FOR UPDATE`;

      const user = await tx.users.findUnique({
        where: { id: ownerId },
        include: { product: true },
      });

      if (!user || user.product?.type !== ProductType.ACADEMIA) {
        return null;
      }

      if (user.academiaId) {
        return await tx.academia.findUnique({ where: { id: user.academiaId } });
      }

      const academia = await tx.academia.create({
        data: { name: user.name },
      });
      await tx.users.update({
        where: { id: ownerId },
        data: { academiaId: academia.id },
      });

      this.logger.log(
        `academia_provisioned owner=${ownerId} academia=${academia.id}`,
      );
      return academia;
    });
  }
}
