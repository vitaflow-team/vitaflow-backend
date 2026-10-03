import { PrismaService } from '@/database/prisma.service';
import { Test } from '@nestjs/testing';
import { ClientsRepository } from './clients.repository';

describe('ClientsRepository (educator student queries)', () => {
  const client = { findFirst: jest.fn(), findMany: jest.fn() };
  let repository: ClientsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ClientsRepository,
        { provide: PrismaService, useValue: { client } },
      ],
    }).compile();
    repository = module.get(ClientsRepository);
  });

  it('UT-099 findOwnedById matches the id only within the professional', async () => {
    client.findFirst.mockResolvedValue(null);

    const result = await repository.findOwnedById('student-1', 'educator-1');

    expect(result).toBeNull();
    expect(client.findFirst).toHaveBeenCalledWith({
      where: { id: 'student-1', professionalId: 'educator-1' },
    });
  });

  it('UT-099 findAllWithLatestAssessment reads only this professional with the latest assessment date', async () => {
    client.findMany.mockResolvedValue([]);

    await repository.findAllWithLatestAssessment('educator-1');

    expect(client.findMany).toHaveBeenCalledWith({
      where: { professionalId: 'educator-1' },
      include: {
        assessments: {
          select: { assessedOn: true },
          orderBy: { assessedOn: 'desc' },
          take: 1,
        },
      },
    });
  });
});
