import { PrismaService } from '@/database/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import { Client, Prisma } from '@prisma/client';
import { clientMock } from 'mock/clients.repository.mock';
import { ClientsRepository } from './clients.repository';

describe('UserRepository Tests', () => {
  let clientsRepository: ClientsRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsRepository,
        {
          provide: PrismaService,
          useValue: {
            client: {
              create: jest
                .fn()
                .mockImplementation(
                  ({ data }: { data: Prisma.ClientCreateInput }) => {
                    return Promise.resolve({
                      id: 'idNewClient',
                      name: data.name,
                      email: data.email,
                      birthDate: new Date('1990-05-20'),
                      phone: data.phone,
                      professionalId: data.professional.connect!.id!,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    } satisfies Client);
                  },
                ),
              findUnique: jest.fn().mockImplementation(({ where }) => {
                return Promise.resolve(
                  clientMock.find((client) => client.id === where.id),
                );
              }),
              findFirst: jest.fn().mockImplementation(({ where }) => {
                const client = clientMock.find(
                  (client) =>
                    client.email.toLowerCase() ===
                      where.email.equals.toLowerCase() &&
                    client.professionalId === where.professionalId,
                );
                return Promise.resolve(client ?? null);
              }),
              findMany: jest.fn().mockImplementation(({ where }) => {
                const client = clientMock.filter((client) => {
                  if (client.professionalId === where.professionalId) {
                    return client;
                  }
                });
                return Promise.resolve(client);
              }),
              update: jest.fn().mockImplementation(({ where, data }) => {
                const client = clientMock.find(
                  (client: Client) => client.id === where.id,
                );

                if (!client) {
                  return Promise.resolve(null);
                }

                const newClient = {
                  ...data,
                  id: client.id,
                };
                return Promise.resolve(newClient);
              }),
              updateMany: jest.fn().mockImplementation(),
              count: jest.fn().mockResolvedValue(3),
              delete: jest.fn().mockImplementation(),
            },
          },
        },
      ],
    }).compile();

    clientsRepository = module.get<ClientsRepository>(ClientsRepository);
  });

  it('should be defined and instantiated', () => {
    expect(clientsRepository).toBeDefined();
  });

  it('Locate user by email and professional id', async () => {
    const newClient = {
      name: 'New Jonh Doe',
      email: 'jonhdoe@id1.com',
      birthDate: new Date('1990-05-20'),
      phone: '987654321',
    };
    const req = {
      user: {
        id: 'User1',
      },
    };

    const client = await clientsRepository.findByEmailAndProfessionalId(
      newClient.email,
      req.user.id,
    );

    expect(client).toBeDefined();
    expect(client?.id).toEqual('1');
  });

  it('Locate user by email and professional id - not found', async () => {
    const newClient = {
      name: 'New Jonh Doe',
      email: 'jonhdoe@idNotFound.com',
      birthDate: new Date('1990-05-20'),
      phone: '987654321',
    };
    const req = {
      user: {
        id: 'User1',
      },
    };

    const client = await clientsRepository.findByEmailAndProfessionalId(
      newClient.email,
      req.user.id,
    );

    expect(client).toBeNull();
  });

  it('Locate client by professional id', async () => {
    const req = {
      user: {
        id: 'User1',
      },
    };

    const client = await clientsRepository.getAllByProfessionalId(req.user.id);

    expect(client).toBeDefined();
    expect(client?.length).toBeGreaterThan(0);
  });

  it('Delete client by id', async () => {
    const id = '1';
    await clientsRepository.delete(id);

    expect(
      (clientsRepository as any).prisma.client.delete,
    ).toHaveBeenCalledWith({
      where: {
        id,
      },
    });
  });

  it('Locate client by id', async () => {
    const client = await clientsRepository.getClientById('1');

    expect(client).toBeDefined();
    expect(client?.id).toEqual('1');
  });

  it('Create user', async () => {
    const newClient = {
      name: 'New Jonh Doe',
      email: 'jonhdoe@id1.com',
      birthDate: new Date('1990-05-20'),
      professional: {
        connect: {
          id: 'User1',
        },
      },
      phone: '987654321',
    };

    const client = await clientsRepository.create(newClient);

    expect(client.id).toEqual('idNewClient');
  });

  it('Update user', async () => {
    const client = {
      name: 'New Jonh Doe',
      email: 'jonhdoe@id1.com',
      birthDate: new Date('1990-05-20'),
      professional: {
        connect: {
          id: 'User1',
        },
      },
      phone: '987654321',
    };

    const updatedClient = await clientsRepository.update('1', client);

    expect(updatedClient.id).toEqual('1');
    expect(updatedClient.name).toEqual('New Jonh Doe');
  });

  it('should set all client user', async () => {
    const userId = 'newUserId';
    const email = 'test@example.com';

    await clientsRepository.setAllClientUser(userId, email);

    expect(
      (clientsRepository as any).prisma.client.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        email: { equals: email, mode: 'insensitive' },
      },
      data: {
        userId,
      },
    });
  });

  it('matches client emails case-insensitively with LIKE wildcards escaped', async () => {
    const client = await clientsRepository.findByEmailAndProfessionalId(
      'JonhDoe@ID1.com',
      'User1',
    );
    expect(client?.id).toEqual('1');

    await clientsRepository.setAllClientUser('newUserId', 'a_b%c@example.com');
    expect(
      (clientsRepository as any).prisma.client.updateMany,
    ).toHaveBeenLastCalledWith({
      where: {
        email: { equals: 'a\\_b\\%c@example.com', mode: 'insensitive' },
      },
      data: { userId: 'newUserId' },
    });
  });

  // UT-004
  it('Count clients by professional id', async () => {
    const total = await clientsRepository.countByProfessionalId('p1');

    expect(total).toEqual(3);
    expect((clientsRepository as any).prisma.client.count).toHaveBeenCalledWith(
      {
        where: {
          professionalId: 'p1',
        },
      },
    );
  });
});

describe('ClientsRepository.findByUserAndProfessionalType', () => {
  const findFirst = jest.fn();
  const prisma = { client: { findFirst } } as unknown as PrismaService;
  const repository = new ClientsRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('scopes by userId and the professional’s product type, newest first', async () => {
    findFirst.mockResolvedValue(null);

    await repository.findByUserAndProfessionalType('user-1', 'NUTRITIONIST');

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        professional: { product: { type: 'NUTRITIONIST' } },
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns null when no linked professional of that type exists', async () => {
    findFirst.mockResolvedValue(null);

    const result = await repository.findByUserAndProfessionalType(
      'user-1',
      'PHYSICAL_EDUCATOR',
    );

    expect(result).toBeNull();
  });
});

describe('ClientsRepository.findByUserAndProfessional', () => {
  const findFirst = jest.fn();
  const prisma = { client: { findFirst } } as unknown as PrismaService;
  const repository = new ClientsRepository(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('scopes by the exact (userId, professionalId) pair', async () => {
    findFirst.mockResolvedValue(null);

    await repository.findByUserAndProfessional('user-1', 'professional-1');

    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', professionalId: 'professional-1' },
    });
  });

  it('returns null when no such relationship exists', async () => {
    findFirst.mockResolvedValue(null);

    const result = await repository.findByUserAndProfessional(
      'user-1',
      'professional-1',
    );

    expect(result).toBeNull();
  });
});
