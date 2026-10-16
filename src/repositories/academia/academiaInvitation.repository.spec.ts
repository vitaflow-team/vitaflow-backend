import { PrismaService } from '@/database/prisma.service';
import { AcademiaInvitationRepository } from './academiaInvitation.repository';

describe('AcademiaInvitationRepository', () => {
  function makePrisma() {
    return {
      academiaInvitation: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
  }

  it('UT-013/UT-023 matches by email case-insensitively for the bare-email, educatorId-null case', async () => {
    const prisma = makePrisma();
    const repository = new AcademiaInvitationRepository(
      prisma as unknown as PrismaService,
    );
    prisma.academiaInvitation.updateMany.mockResolvedValue({ count: 1 });

    await repository.transitionIfPendingForEducator(
      'invite-1',
      'educator-1',
      'Joao@Example.com',
      'ACCEPTED',
    );

    expect(prisma.academiaInvitation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'invite-1',
        kind: 'EMPLOYMENT',
        status: 'PENDING',
        OR: [
          { educatorId: 'educator-1' },
          {
            educatorId: null,
            email: { equals: 'Joao@Example.com', mode: 'insensitive' },
          },
        ],
      },
      data: {
        status: 'ACCEPTED',
        decidedAt: expect.any(Date),
        educatorId: 'educator-1',
      },
    });
  });

  it('UT-014 the conditional updateMany is the sole decision point — a count of 0 means the caller lost the race', async () => {
    const prisma = makePrisma();
    const repository = new AcademiaInvitationRepository(
      prisma as unknown as PrismaService,
    );
    prisma.academiaInvitation.updateMany.mockResolvedValue({ count: 0 });

    const count = await repository.transitionIfPendingForEducator(
      'invite-1',
      'educator-1',
      'educador@example.com',
      'ACCEPTED',
    );

    expect(count).toBe(0);
  });

  it('listSentByAcademia returns every invitation for the academia with the academia relation included', async () => {
    const prisma = makePrisma();
    const repository = new AcademiaInvitationRepository(
      prisma as unknown as PrismaService,
    );
    const rows = [{ id: 'invite-1' }];
    prisma.academiaInvitation.findMany.mockResolvedValue(rows);

    const result = await repository.listSentByAcademia('academia-1');

    expect(prisma.academiaInvitation.findMany).toHaveBeenCalledWith({
      where: { academiaId: 'academia-1' },
      include: { academia: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toBe(rows);
  });

  it('cancelIfPending only matches a PENDING row owned by this academia', async () => {
    const prisma = makePrisma();
    const repository = new AcademiaInvitationRepository(
      prisma as unknown as PrismaService,
    );
    prisma.academiaInvitation.updateMany.mockResolvedValue({ count: 1 });

    await repository.cancelIfPending('invite-1', 'academia-1');

    expect(prisma.academiaInvitation.updateMany).toHaveBeenCalledWith({
      where: { id: 'invite-1', academiaId: 'academia-1', status: 'PENDING' },
      data: { status: 'CANCELLED', decidedAt: expect.any(Date) },
    });
  });
});
