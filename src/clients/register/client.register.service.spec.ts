import { AppError } from '@/utils/app.erro';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ClientsRepositoryMock,
  clientMock,
} from 'mock/clients.repository.mock';
import { jwtServiceMock } from 'mock/jwtService.mock';
import { userRepositoryMock } from 'mock/user.repository.mock';
import { ClientRegisterService } from './client.register.service';

const clients = ClientsRepositoryMock.useValue;

// clientMock[0] belongs to User1; clientMock[1] belongs to User2.
const ownClient = clientMock[0];
const foreignClient = clientMock[1];

describe('ClientRegisterService.postRegister — ownership', () => {
  let service: ClientRegisterService;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [
        ClientRegisterService,
        userRepositoryMock,
        ClientsRepositoryMock,
        jwtServiceMock,
      ],
    }).compile();

    service = moduleFixture.get(ClientRegisterService);
    jest.clearAllMocks();
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  // UT-001
  it('updates a client owned by the calling professional', async () => {
    const result = await service.postRegister(
      {
        id: ownClient.id,
        name: 'Renamed Client',
        email: ownClient.email,
        phone: '987654321',
        birthDate: new Date('1990-05-20'),
      },
      ownClient.professionalId,
    );

    expect(clients.update).toHaveBeenCalledWith(
      ownClient.id,
      expect.objectContaining({ name: 'Renamed Client' }),
    );
    expect(result.name).toEqual('Renamed Client');
  });

  // UT-002
  it("rejects with 404 and never writes when the id is another professional's client", async () => {
    const attempt = service.postRegister(
      {
        id: foreignClient.id,
        name: 'Hijacked',
        email: 'attacker@example.com',
        phone: '000',
        birthDate: new Date('1990-05-20'),
      },
      ownClient.professionalId,
    );

    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({ status: 404 });
    expect(clients.update).not.toHaveBeenCalled();
    expect(clients.create).not.toHaveBeenCalled();
  });

  it('answers the same 404 for an id that does not exist at all', async () => {
    const attempt = service.postRegister(
      {
        id: 'does-not-exist',
        name: 'Ghost',
        email: 'ghost@example.com',
        phone: '000',
        birthDate: new Date('1990-05-20'),
      },
      ownClient.professionalId,
    );

    await expect(attempt).rejects.toMatchObject({
      status: 404,
      message: 'Cliente não encontrado.',
    });
    expect(clients.update).not.toHaveBeenCalled();
  });

  it('creates a client without any ownership lookup when no id is sent', async () => {
    const result = await service.postRegister(
      {
        name: 'Brand New',
        email: 'brand-new@example.com',
        phone: '123',
        birthDate: new Date('1990-05-20'),
      },
      ownClient.professionalId,
    );

    expect(clients.getClientById).not.toHaveBeenCalled();
    expect(clients.create).toHaveBeenCalledTimes(1);
    expect(result.id).toEqual('idNewClient');
  });

  // standards-enforcement UT-002
  it('rejects with 409 a new client whose email the professional already registered', async () => {
    const attempt = service.postRegister(
      {
        name: 'Duplicate',
        email: ownClient.email,
        phone: '123',
        birthDate: new Date('1990-05-20'),
      },
      ownClient.professionalId,
    );

    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({
      status: 409,
      message: 'Cliente já cadastrado para o profissional.',
    });
    expect(clients.create).not.toHaveBeenCalled();
  });

  // standards-enforcement UT-002
  it("rejects with 409 an update that takes over another client's email", async () => {
    // clientMock[2] and clientMock[1] both belong to User2, with different emails.
    const target = clientMock[2];
    const attempt = service.postRegister(
      {
        id: target.id,
        name: 'Renamed',
        email: foreignClient.email,
        phone: '123',
        birthDate: new Date('1990-05-20'),
      },
      target.professionalId,
    );

    await expect(attempt).rejects.toBeInstanceOf(AppError);
    await expect(attempt).rejects.toMatchObject({
      status: 409,
      message: 'Cliente cadastrado com outro ID.',
    });
    expect(clients.update).not.toHaveBeenCalled();
  });
});
