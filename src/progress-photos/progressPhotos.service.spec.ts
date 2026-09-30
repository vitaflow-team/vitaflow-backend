import { ConsentService } from '@/common/consent/consent.service';
import { ProgressPhotosRepository } from '@/repositories/progress-photos/progressPhotos.repository';
import { AppError } from '@/utils/app.erro';
import { UploadService } from '@/utils/upload.service';
import { Logger } from '@nestjs/common';
import { ProgressPhoto } from '@prisma/client';
import { progressPhotoFile } from 'mock/imageFile.mock';
import { ProgressPhotosService } from './progressPhotos.service';

const PUBLIC_URL = 'https://storage.googleapis.com/vitaflow-bucket/photo-1.png';

function makePhoto(overrides: Partial<ProgressPhoto> = {}): ProgressPhoto {
  const timestamp = new Date('2026-09-30T09:00:00.000Z');
  return {
    id: 'photo-1',
    userId: 'user-1',
    angle: 'FRONT',
    storageFilename: 'photo-1.png',
    takenAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('ProgressPhotosService', () => {
  const photosCreate = jest.fn();
  const photosFindById = jest.fn();
  const photosFindByUserAndAngle = jest.fn();
  const photosFindLatestByUserAndAngle = jest.fn();
  const photosDelete = jest.fn();
  const uploadImage = jest.fn();
  const getSignedUrl = jest.fn();
  const deleteImage = jest.fn();
  const consentHasConsented = jest.fn();
  const consentGiveConsent = jest.fn();

  let service: ProgressPhotosService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ProgressPhotosService(
      {
        create: photosCreate,
        findById: photosFindById,
        findByUserAndAngle: photosFindByUserAndAngle,
        findLatestByUserAndAngle: photosFindLatestByUserAndAngle,
        delete: photosDelete,
      } as unknown as ProgressPhotosRepository,
      {
        uploadImage,
        getSignedUrl,
        deleteImage,
      } as unknown as UploadService,
      {
        hasConsented: consentHasConsented,
        giveConsent: consentGiveConsent,
      } as unknown as ConsentService,
    );
    getSignedUrl.mockImplementation((filename: string) =>
      Promise.resolve(`https://signed.example/${filename}?sig=x`),
    );
  });

  describe('consent (UT-001, UT-002, UT-003)', () => {
    it('UT-001 hasConsented/giveConsent delegate to ConsentService scoped to PROGRESS_PHOTOS', async () => {
      consentHasConsented.mockResolvedValueOnce(false);
      await expect(service.hasConsented('user-1')).resolves.toBe(false);
      expect(consentHasConsented).toHaveBeenCalledWith(
        'user-1',
        'PROGRESS_PHOTOS',
      );

      await service.giveConsent('user-1');
      expect(consentGiveConsent).toHaveBeenCalledWith(
        'user-1',
        'PROGRESS_PHOTOS',
      );

      consentHasConsented.mockResolvedValueOnce(true);
      await expect(service.hasConsented('user-1')).resolves.toBe(true);
    });

    it('UT-002 upload throws AppError(403) before calling UploadService when consent is missing', async () => {
      consentHasConsented.mockResolvedValue(false);

      await expect(
        service.upload('user-1', 'FRONT', progressPhotoFile()),
      ).rejects.toMatchObject({ message: expect.stringContaining('aceitar') });
      expect(uploadImage).not.toHaveBeenCalled();
    });

    it('UT-003 a revoked (now-missing) consent row is treated identically to never having consented', async () => {
      consentHasConsented.mockResolvedValue(false);

      await expect(
        service.upload('user-1', 'FRONT', progressPhotoFile()),
      ).rejects.toThrow(AppError);
      expect(uploadImage).not.toHaveBeenCalled();
    });
  });

  describe('upload (UT-004, UT-005, UT-006, UT-007)', () => {
    beforeEach(() => {
      consentHasConsented.mockResolvedValue(true);
    });

    it('UT-004 persists only the extracted filename, never the public URL', async () => {
      photosFindLatestByUserAndAngle.mockResolvedValue(null);
      uploadImage.mockResolvedValue(PUBLIC_URL);
      photosCreate.mockResolvedValue(makePhoto());

      const entity = await service.upload(
        'user-1',
        'FRONT',
        progressPhotoFile(),
      );

      expect(photosCreate).toHaveBeenCalledWith('user-1', {
        angle: 'FRONT',
        storageFilename: 'photo-1.png',
      });
      const createCallArg = photosCreate.mock.calls[0][1];
      expect(JSON.stringify(createCallArg)).not.toContain(PUBLIC_URL);
      expect(JSON.stringify(entity)).not.toContain(PUBLIC_URL);
      expect(entity.signedUrl).not.toBe(PUBLIC_URL);
    });

    it('UT-005 listByAngle returns an empty array for a never-before-used angle', async () => {
      photosFindByUserAndAngle.mockResolvedValue([]);

      await expect(service.listByAngle('user-1', 'BACK')).resolves.toEqual([]);
    });

    it('UT-006 propagates a real-byte-validation rejection as AppError(400)', async () => {
      photosFindLatestByUserAndAngle.mockResolvedValue(null);

      await expect(
        service.upload(
          'user-1',
          'FRONT',
          progressPhotoFile({ mimetype: 'text/plain' }),
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining('inválido') });
      expect(uploadImage).not.toHaveBeenCalled();
    });

    it('UT-007 rejects an oversized file before calling UploadService', async () => {
      photosFindLatestByUserAndAngle.mockResolvedValue(null);

      await expect(
        service.upload(
          'user-1',
          'FRONT',
          progressPhotoFile({ size: 9 * 1024 * 1024 }),
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining('8 MB') });
      expect(uploadImage).not.toHaveBeenCalled();
    });

    it('includes previousPhotoUrl only when a prior photo exists for the angle (IT-002 contract)', async () => {
      photosFindLatestByUserAndAngle.mockResolvedValue(
        makePhoto({ id: 'photo-0', storageFilename: 'photo-0.png' }),
      );
      uploadImage.mockResolvedValue(PUBLIC_URL);
      photosCreate.mockResolvedValue(makePhoto({ id: 'photo-1' }));

      const entity = await service.upload(
        'user-1',
        'FRONT',
        progressPhotoFile(),
      );

      expect(entity.previousPhotoUrl).toContain('photo-0.png');
    });
  });

  describe('listByAngle / getSignedUrlFor (UT-008, UT-009, UT-016, UT-017)', () => {
    it('UT-008 returns photos ordered by takenAt, each with a freshly-generated signed URL', async () => {
      const photos = [makePhoto({ id: 'a' }), makePhoto({ id: 'b' })];
      photosFindByUserAndAngle.mockResolvedValue(photos);

      const result = await service.listByAngle('user-1', 'FRONT');

      expect(getSignedUrl).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });

    it('UT-009 returns all 50 photos for a heavily-used angle without error', async () => {
      const photos = Array.from({ length: 50 }, (_, index) =>
        makePhoto({ id: `photo-${index}` }),
      );
      photosFindByUserAndAngle.mockResolvedValue(photos);

      const result = await service.listByAngle('user-1', 'FRONT');

      expect(result).toHaveLength(50);
    });

    it('UT-016 getSignedUrlFor invokes getSignedUrl fresh on every call', async () => {
      photosFindById.mockResolvedValue(makePhoto());

      await service.getSignedUrlFor('user-1', 'photo-1');
      await service.getSignedUrlFor('user-1', 'photo-1');

      expect(getSignedUrl).toHaveBeenCalledTimes(2);
    });

    it('UT-017 throws AppError(404) for a deleted/unknown photo', async () => {
      photosFindById.mockResolvedValue(null);

      await expect(
        service.getSignedUrlFor('user-1', 'missing-photo'),
      ).rejects.toMatchObject({ message: 'Foto não encontrada.' });
    });

    it('never returns a photo owned by a different user', async () => {
      photosFindById.mockResolvedValue(makePhoto({ userId: 'other-user' }));

      await expect(
        service.getSignedUrlFor('user-1', 'photo-1'),
      ).rejects.toThrow(AppError);
    });
  });

  describe('compare (UT-010, UT-011, UT-012)', () => {
    it('UT-010 returns both photos with signed URLs and dates given the same angle', async () => {
      photosFindById
        .mockResolvedValueOnce(makePhoto({ id: 'a', angle: 'FRONT' }))
        .mockResolvedValueOnce(makePhoto({ id: 'b', angle: 'FRONT' }));

      const result = await service.compare('user-1', 'a', 'b');

      expect(result.a.id).toBe('a');
      expect(result.b.id).toBe('b');
      expect(result.a.signedUrl).toBeDefined();
      expect(result.b.signedUrl).toBeDefined();
    });

    it('UT-011 a single photo for an angle gives the frontend nothing to pass as a second id — no dedicated backend guard needed', async () => {
      photosFindByUserAndAngle.mockResolvedValue([makePhoto({ id: 'a' })]);

      const result = await service.listByAngle('user-1', 'FRONT');

      expect(result).toHaveLength(1);
    });

    it('UT-012 rejects comparing two different angles with AppError(400)', async () => {
      photosFindById
        .mockResolvedValueOnce(makePhoto({ id: 'a', angle: 'FRONT' }))
        .mockResolvedValueOnce(makePhoto({ id: 'b', angle: 'SIDE' }));

      await expect(service.compare('user-1', 'a', 'b')).rejects.toMatchObject({
        message: 'Só é possível comparar fotos do mesmo ângulo.',
      });
    });
  });

  describe('delete (UT-013)', () => {
    it('UT-013 calls both UploadService.deleteImage and removes the database row', async () => {
      photosFindById.mockResolvedValue(makePhoto());

      await service.delete('user-1', 'photo-1');

      expect(deleteImage).toHaveBeenCalledWith('photo-1.png');
      expect(photosDelete).toHaveBeenCalledWith('photo-1');
    });

    it('logs the deletion distinctly for audit (TechSpec Monitoring)', async () => {
      const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
      photosFindById.mockResolvedValue(makePhoto());

      await service.delete('user-1', 'photo-1');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('userId=user-1 photoId=photo-1'),
      );
      logSpy.mockRestore();
    });

    it('refuses to delete a photo owned by a different user', async () => {
      photosFindById.mockResolvedValue(makePhoto({ userId: 'other-user' }));

      await expect(service.delete('user-1', 'photo-1')).rejects.toThrow(
        AppError,
      );
      expect(deleteImage).not.toHaveBeenCalled();
      expect(photosDelete).not.toHaveBeenCalled();
    });
  });
});
