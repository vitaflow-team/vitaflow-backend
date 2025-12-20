import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { ClientsRepositoryMock } from 'mock/clients.repository.mock';
import { jwtServiceMock } from 'mock/jwtService.mock';
import { userRepositoryMock } from 'mock/user.repository.mock';
import { ClientRegisterDTO } from './client.register.Dto';
import { ClientRegisterController } from './client.register.controller';

describe('ClientRegisterController Tests', () => {
  let controller: ClientRegisterController;

  const req = {
    user: {
      id: 'User1',
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ClientRegisterController],
      providers: [userRepositoryMock, ClientsRepositoryMock, jwtServiceMock],
    }).compile();

    controller = moduleFixture.get<ClientRegisterController>(
      ClientRegisterController,
    );
  });

  it('Should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('ClientRegisterController.postRegister - Tests', () => {
    it('Register new client - Success', async () => {
      const newClient = {
        name: 'New Jonh Doe',
        email: 'newjonhdoe@new.com',
        birthDate: new Date('1990-05-20'),
        phone: '987654321',
      };

      const result = await controller.postRegister(newClient, req);

      expect(result.id).toEqual('idNewClient');
      expect(result.email).toEqual(newClient.email);
      expect(result.birthDate).toBeInstanceOf(Date);
    });

    it('Update user profile - string conversion to DTO', () => {
      const newClient = {
        name: 'New Jonh Doe',
        email: 'jonhdoe@id1.com',
        birthDate: new Date('1990-05-20'),
        phone: '987654321',
      };

      const body = plainToInstance(ClientRegisterDTO, newClient);

      expect(body.birthDate).toBeInstanceOf(Date);
    });

    it('Register new client - Client already exists', async () => {
      const newClient = {
        name: 'New Jonh Doe',
        email: 'jonhdoe@id1.com',
        birthDate: new Date('1990-05-20'),
        phone: '987654321',
      };

      await expect(
        controller.postRegister(newClient, req),
      ).rejects.toHaveProperty('statusCode', 402);
    });
  });

  describe('ClientRegisterController.getClients - Tests', () => {
    it('Get clients - Success', async () => {
      const result = await controller.getClients(req);

      expect(result).toBeDefined();
      expect(result?.length).toBeGreaterThan(0);
    });
  });
});
