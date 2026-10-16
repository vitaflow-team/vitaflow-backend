import { TemplatesService } from '@/clinical-records/templates/templates.service';
import { PrismaService } from '@/database/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { Academia, ProductType } from '@prisma/client';

@Injectable()
export class AcademiaProvisioningService {
  private readonly logger = new Logger(AcademiaProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
  ) {}

  async provisionForOwner(ownerId: string): Promise<Academia | null> {
    const { academia, isNew } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Users" WHERE "id" = ${ownerId} FOR UPDATE`;

      const user = await tx.users.findUnique({
        where: { id: ownerId },
        include: { product: true },
      });

      if (!user || user.product?.type !== ProductType.ACADEMIA) {
        return { academia: null, isNew: false };
      }

      if (user.academiaId) {
        const existing = await tx.academia.findUnique({
          where: { id: user.academiaId },
        });
        return { academia: existing, isNew: false };
      }

      const created = await tx.academia.create({
        data: { name: user.name },
      });
      await tx.users.update({
        where: { id: ownerId },
        data: { academiaId: created.id },
      });

      this.logger.log(
        `academia_provisioned owner=${ownerId} academia=${created.id}`,
      );
      return { academia: created, isNew: true };
    });

    // Starter templates (PRD ADR-004) for every newly provisioned academia —
    // called only after the creating transaction has committed, so the
    // academiaId it references is guaranteed visible.
    if (isNew && academia) {
      await this.templates.ensureStarterTemplates(
        { academiaId: academia.id },
        ProductType.ACADEMIA,
      );
    }

    return academia;
  }
}
