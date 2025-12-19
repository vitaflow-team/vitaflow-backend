import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { Client, Prisma } from '@prisma/client';

export const clientMock = [
  {
    id: '1',
    name: 'Jonh Doe id 1',
    email: 'jonhdoe@id1.com',
    birthDate: new Date('1990-05-20'),
    phone: '9999999',
    professionalId: 'User1',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: '2',
    name: 'Jonh Doe id 2',
    email: 'jonhdoe@id1.com',
    birthDate: new Date('1990-05-20'),
    phone: '9999999',
    professionalId: 'User2',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: '3',
    name: 'Jonh Doe id 3',
    email: 'jonhdoe@id2.com',
    birthDate: new Date('1990-05-20'),
    phone: '9999999',
    professionalId: 'User2',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
] as Client[];

export const ClientsRepositoryMock = {
  provide: ClientsRepository,
  useValue: {
    create: jest
      .fn()
      .mockImplementation((data: Prisma.ClientUncheckedCreateInput) => {
        return Promise.resolve({
          id: 'idNewClient',
          name: data.name,
          email: data.email,
          birthDate: new Date('1990-05-20'),
          phone: data.phone,
          professionalId: data.professionalId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } satisfies Client);
      }),
    findByEmailAndProfessionalId: jest
      .fn()
      .mockImplementation((email, userId) => {
        const client = clientMock.filter((client) => {
          if (client.email === email && client.professionalId === userId) {
            return client;
          }
        });
        if (client[0]) {
          return Promise.resolve(client[0]);
        } else {
          return Promise.resolve(null);
        }
      }),
  },
};
