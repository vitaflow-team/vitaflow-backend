import { ConsentService } from '@/common/consent/consent.service';
import { ProgressPhotosRepository } from '@/repositories/progress-photos/progressPhotos.repository';
import { AppError } from '@/utils/app.erro';
import { UploadService } from '@/utils/upload.service';
import { Injectable, Logger } from '@nestjs/common';
import { PhotoAngle, ProgressPhoto } from '@prisma/client';
import { assertValidProgressPhoto } from './progressPhotoUpload';
import {
  CompareResultEntity,
  ProgressPhotoEntity,
} from './progressPhoto.entity';

const CONSENT_REQUIRED =
  'É necessário aceitar o uso de fotos de progresso primeiro.';
const ANGLE_MISMATCH = 'Só é possível comparar fotos do mesmo ângulo.';
const NOT_FOUND = 'Foto não encontrada.';
const CONSENT_FEATURE = 'PROGRESS_PHOTOS';

@Injectable()
export class ProgressPhotosService {
  private readonly logger = new Logger(ProgressPhotosService.name);

  constructor(
    private readonly photos: ProgressPhotosRepository,
    private readonly uploadService: UploadService,
    private readonly consentService: ConsentService,
  ) {}

  async hasConsented(userId: string): Promise<boolean> {
    return await this.consentService.hasConsented(userId, CONSENT_FEATURE);
  }

  async giveConsent(userId: string): Promise<void> {
    await this.consentService.giveConsent(userId, CONSENT_FEATURE);
  }

  // The previous photo for this angle is read BEFORE the new one is
  // persisted, so it never resolves to the photo just uploaded — its
  // signed URL becomes `previousPhotoUrl` (IT-002), the overlay guide's
  // source on the frontend.
  async upload(
    userId: string,
    angle: PhotoAngle,
    file: Express.Multer.File,
  ): Promise<ProgressPhotoEntity> {
    const consented = await this.hasConsented(userId);
    if (!consented) {
      throw new AppError(CONSENT_REQUIRED, 403);
    }
    assertValidProgressPhoto(file);

    const previous = await this.photos.findLatestByUserAndAngle(userId, angle);

    const publicUrl = await this.uploadService.uploadImage(file);
    const storageFilename = extractFilename(publicUrl);
    const photo = await this.photos.create(userId, {
      angle,
      storageFilename,
    });

    const entity = await this.toEntity(photo);
    if (previous) {
      entity.previousPhotoUrl = await this.uploadService.getSignedUrl(
        previous.storageFilename,
      );
    }
    return entity;
  }

  async listByAngle(
    userId: string,
    angle: PhotoAngle,
  ): Promise<ProgressPhotoEntity[]> {
    const photos = await this.photos.findByUserAndAngle(userId, angle);
    return await Promise.all(photos.map((photo) => this.toEntity(photo)));
  }

  async getSignedUrlFor(userId: string, photoId: string): Promise<string> {
    const photo = await this.assertOwnedPhoto(userId, photoId);
    return await this.uploadService.getSignedUrl(photo.storageFilename);
  }

  async compare(
    userId: string,
    photoIdA: string,
    photoIdB: string,
  ): Promise<CompareResultEntity> {
    const [a, b] = await Promise.all([
      this.assertOwnedPhoto(userId, photoIdA),
      this.assertOwnedPhoto(userId, photoIdB),
    ]);
    if (a.angle !== b.angle) {
      throw new AppError(ANGLE_MISMATCH, 400);
    }

    const [entityA, entityB] = await Promise.all([
      this.toEntity(a),
      this.toEntity(b),
    ]);
    return { a: entityA, b: entityB };
  }

  // Storage object first, database row second: a mocked/partial storage
  // failure never leaves a dangling DB row with nothing behind it, and
  // both calls are independently verifiable (UT-013).
  async delete(userId: string, photoId: string): Promise<void> {
    const photo = await this.assertOwnedPhoto(userId, photoId);
    await this.uploadService.deleteImage(photo.storageFilename);
    await this.photos.delete(photoId);

    // Distinct from a normal request log (TechSpec § Monitoring): this is
    // the product's most sensitive user-uploaded data category, and
    // deletion correctness (LGPD Art. 18) is a compliance-relevant
    // guarantee worth being able to audit independently of the DB state.
    this.logger.log(
      `progress_photo_deleted userId=${userId} photoId=${photoId} at=${new Date().toISOString()}`,
    );
  }

  private async assertOwnedPhoto(
    userId: string,
    photoId: string,
  ): Promise<ProgressPhoto> {
    const photo = await this.photos.findById(photoId);
    if (!photo || photo.userId !== userId) {
      throw new AppError(NOT_FOUND, 404);
    }
    return photo;
  }

  private async toEntity(photo: ProgressPhoto): Promise<ProgressPhotoEntity> {
    return {
      id: photo.id,
      angle: photo.angle,
      takenAt: photo.takenAt,
      signedUrl: await this.uploadService.getSignedUrl(photo.storageFilename),
    };
  }
}

// Mirrors `UploadService.deleteImage`'s own last-`/`-segment parsing,
// applied here at write time instead of read time (TechSpec § Integration
// Points) — the only piece of the public URL ever persisted or returned.
function extractFilename(publicUrl: string): string {
  const filename = publicUrl.split('/').pop();
  if (!filename) {
    throw new AppError('Falha ao processar o upload da imagem.', 500);
  }
  return filename;
}
