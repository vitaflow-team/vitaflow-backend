import { PrismaService } from '@/database/prisma.service';
import { Test } from '@nestjs/testing';
import {
  AssessmentInput,
  PhysicalAssessmentsRepository,
} from './physicalAssessments.repository';

const input: AssessmentInput = {
  assessedOn: new Date('2026-09-15T00:00:00.000Z'),
  weightKg: 78.2,
  heightCm: 179,
};

describe('PhysicalAssessmentsRepository', () => {
  const physicalAssessment = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  let repository: PhysicalAssessmentsRepository;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        PhysicalAssessmentsRepository,
        { provide: PrismaService, useValue: { physicalAssessment } },
      ],
    }).compile();
    repository = module.get(PhysicalAssessmentsRepository);
  });

  it('create attaches the assessment to the student record', async () => {
    physicalAssessment.create.mockResolvedValue({ id: 'a1' });

    await repository.create('client-1', input);

    expect(physicalAssessment.create).toHaveBeenCalledWith({
      data: { ...input, clientId: 'client-1' },
    });
  });

  it('findOwned is scoped to the student record', async () => {
    await repository.findOwned('a1', 'client-1');

    expect(physicalAssessment.findFirst).toHaveBeenCalledWith({
      where: { id: 'a1', clientId: 'client-1' },
    });
  });

  it('listByClient pages newest first and counts the student total', async () => {
    physicalAssessment.findMany.mockResolvedValue([{ id: 'a1' }]);
    physicalAssessment.count.mockResolvedValue(21);

    const result = await repository.listByClient('client-1', 20, 20);

    expect(result).toEqual({ items: [{ id: 'a1' }], total: 21 });
    expect(physicalAssessment.findMany).toHaveBeenCalledWith({
      where: { clientId: 'client-1' },
      orderBy: [{ assessedOn: 'desc' }, { createdAt: 'desc' }],
      skip: 20,
      take: 20,
    });
  });

  it('findAllForVariation selects only the fields the variation needs', async () => {
    await repository.findAllForVariation('client-1');

    expect(physicalAssessment.findMany).toHaveBeenCalledWith({
      where: { clientId: 'client-1' },
      select: {
        assessedOn: true,
        createdAt: true,
        weightKg: true,
        bodyFatPercent: true,
      },
    });
  });

  it('findLatestByClient returns the newest first, limited', async () => {
    await repository.findLatestByClient('client-1', 3);

    expect(physicalAssessment.findMany).toHaveBeenCalledWith({
      where: { clientId: 'client-1' },
      orderBy: [{ assessedOn: 'desc' }, { createdAt: 'desc' }],
      take: 3,
    });
  });

  it('findRecentByLinkedUser reads every record linked to the account', async () => {
    const since = new Date('2026-09-01T00:00:00.000Z');

    await repository.findRecentByLinkedUser('user-1', 10, since);

    expect(physicalAssessment.findMany).toHaveBeenCalledWith({
      where: { client: { userId: 'user-1' }, assessedOn: { gte: since } },
      include: {
        client: {
          select: { professional: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ assessedOn: 'desc' }, { createdAt: 'desc' }],
      take: 10,
    });
  });

  it('findRecentByLinkedUser omits the date filter without a window', async () => {
    await repository.findRecentByLinkedUser('user-1', 10);

    expect(physicalAssessment.findMany.mock.calls[0][0].where).toEqual({
      client: { userId: 'user-1' },
    });
  });

  it('update and delete address the assessment by id', async () => {
    await repository.update('a1', input);
    await repository.delete('a1');

    expect(physicalAssessment.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: input,
    });
    expect(physicalAssessment.delete).toHaveBeenCalledWith({
      where: { id: 'a1' },
    });
  });
});
