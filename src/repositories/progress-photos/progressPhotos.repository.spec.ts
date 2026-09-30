import { PrismaService } from '@/database/prisma.service';
import { ProgressPhotosRepository } from './progressPhotos.repository';

describe('ProgressPhotosRepository', () => {
  const create = jest.fn();
  const findUnique = jest.fn();
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const deleteFn = jest.fn();
  const prisma = {
    progressPhoto: {
      create,
      findUnique,
      findMany,
      findFirst,
      delete: deleteFn,
    },
  } as unknown as PrismaService;
  const repository = new ProgressPhotosRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('create persists angle/storageFilename scoped to the user', async () => {
    create.mockResolvedValue({ id: 'photo-1' });

    await repository.create('user-1', {
      angle: 'FRONT',
      storageFilename: 'abc.jpg',
    });

    expect(create).toHaveBeenCalledWith({
      data: { angle: 'FRONT', storageFilename: 'abc.jpg', userId: 'user-1' },
    });
  });

  it('findById delegates to findUnique', async () => {
    findUnique.mockResolvedValue({ id: 'photo-1' });

    const result = await repository.findById('photo-1');

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'photo-1' } });
    expect(result).toEqual({ id: 'photo-1' });
  });

  it('findByUserAndAngle filters and orders ascending by takenAt', async () => {
    findMany.mockResolvedValue([]);

    await repository.findByUserAndAngle('user-1', 'FRONT');

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', angle: 'FRONT' },
      orderBy: { takenAt: 'asc' },
    });
  });

  it('findLatestByUserAndAngle orders descending and takes the first', async () => {
    findFirst.mockResolvedValue({ id: 'photo-2' });

    const result = await repository.findLatestByUserAndAngle('user-1', 'FRONT');

    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', angle: 'FRONT' },
      orderBy: { takenAt: 'desc' },
    });
    expect(result).toEqual({ id: 'photo-2' });
  });

  it('findAllByUser returns every photo regardless of angle', async () => {
    findMany.mockResolvedValue([{ id: 'photo-1' }, { id: 'photo-2' }]);

    const result = await repository.findAllByUser('user-1');

    expect(findMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    expect(result).toHaveLength(2);
  });

  it('delete removes the row by id', async () => {
    await repository.delete('photo-1');

    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'photo-1' } });
  });
});
