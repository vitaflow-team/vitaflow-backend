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
                if (where.id) {
                  return Promise.resolve(
                    clientMock.find((client) => client.id === where.id),
                  );
                }

                const client = clientMock.filter((client) => {
                  if (
                    client.email === where.email_professionalId.email &&
                    client.professionalId ===
                      where.email_professionalId.professionalId
                  ) {
                    return client;
                  }
                });
                if (client[0]) {
                  return Promise.resolve(client[0]);
                } else {
                  return Promise.resolve(null);
                }
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
        email,
      },
      data: {
        userId,
      },
    });
  });
});
