import { PrismaService } from '@/database/prisma.service';
import { Injectable } from '@nestjs/common';
import { PhotoAngle, ProgressPhoto } from '@prisma/client';

export interface ProgressPhotoInput {
  angle: PhotoAngle;
  storageFilename: string;
  takenAt?: Date;
}

@Injectable()
export class ProgressPhotosRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    data: ProgressPhotoInput,
  ): Promise<ProgressPhoto> {
    return await this.prisma.progressPhoto.create({
      data: { ...data, userId },
    });
  }

  async findById(id: string): Promise<ProgressPhoto | null> {
    return await this.prisma.progressPhoto.findUnique({ where: { id } });
  }

  async findByUserAndAngle(
    userId: string,
    angle: PhotoAngle,
  ): Promise<ProgressPhoto[]> {
    return await this.prisma.progressPhoto.findMany({
      where: { userId, angle },
      orderBy: { takenAt: 'asc' },
    });
  }

  async findLatestByUserAndAngle(
    userId: string,
    angle: PhotoAngle,
  ): Promise<ProgressPhoto | null> {
    return await this.prisma.progressPhoto.findFirst({
      where: { userId, angle },
      orderBy: { takenAt: 'desc' },
    });
  }

  async findAllByUser(userId: string): Promise<ProgressPhoto[]> {
    return await this.prisma.progressPhoto.findMany({ where: { userId } });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.progressPhoto.delete({ where: { id } });
  }
}
