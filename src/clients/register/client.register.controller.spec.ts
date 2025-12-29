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
      expect(result.userId).toBeNull();
      expect(result.birthDate).toBeInstanceOf(Date);
    });

    it('Register new client - Success - User already exists', async () => {
      const newClient = {
        name: 'New Jonh Doe',
        email: 'jonhdoeActive@jonhdoe.com',
        birthDate: new Date('1990-05-20'),
        phone: '987654321',
      };

      const result = await controller.postRegister(newClient, req);

      expect(result.id).toEqual('idNewClient');
      expect(result.email).toEqual(newClient.email);
      expect(result.userId).toEqual('3');
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

      await expect(controller.postRegister(newClient, req)).rejects.toThrow(
        'Cliente já cadastrado para o profissional',
      );
    });

    it('Register new client - Client already exists with another id', async () => {
      const newClient = {
        id: '2',
        name: 'New Jonh Doe',
        email: 'jonhdoe@id1.com',
        birthDate: new Date('1990-05-20'),
        phone: '987654321',
      };

      await expect(controller.postRegister(newClient, req)).rejects.toThrow(
        'Cliente cadastrado com outro ID.',
      );
    });

    it('Update client - Success', async () => {
      const newClient = {
        id: '1',
        name: 'New Jonh Doe',
        email: 'jonhdoe@id1.com',
        birthDate: new Date('1990-05-20'),
        phone: '987654321',
      };

      const updateUser = await controller.postRegister(newClient, req);

      expect(updateUser.name).toEqual(newClient.name);
    });
  });

  describe('ClientRegisterController.getClients - Tests', () => {
    it('Get clients - Success', async () => {
      const result = await controller.getClients(req);

      expect(result).toBeDefined();
      expect(result?.length).toBeGreaterThan(0);
    });
  });

  describe('ClientRegisterController.getClientById - Tests', () => {
    it('Get client by id - Another user client', async () => {
      await expect(controller.getClientById('2', req)).rejects.toThrow(
        'Unauthorized access.',
      );
    });

    it('Get client by id - Success', async () => {
      const result = await controller.getClientById('1', req);

      expect(result).toBeDefined();
      expect(result?.id).toEqual('1');
    });
  });
});
