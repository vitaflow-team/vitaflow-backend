import { AuthGuard } from '@/auth/auth.guard';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { UseGuards } from '@nestjs/common';
import { ClientRegisterDTO } from './client.register.Dto';

@UseGuards(AuthGuard)
export class ClientRegisterService {
  constructor(
    private clients: ClientsRepository,

    private users: UserRepository,
  ) {}

  async getClients(userId: string) {
    const result = await this.clients.getAllByProfessionalId(userId);

    return result;
  }

  async getClientById(id: string, userId: string) {
    const client = await this.clients.getClientById(id);

    if (client && client.professionalId !== userId) {
      throw new AppError('Unauthorized access.', 401);
    }

    return client;
  }

  async deleteClientById(id: string, userId: string) {
    const client = await this.clients.getClientById(id);

    if (client) {
      if (client.professionalId !== userId) {
        throw new AppError('Exclusão não permitida.', 401);
      }

      await this.clients.delete(id);
    }

    return;
  }

  async postRegister(body: ClientRegisterDTO, userId: string) {
    const { id, name, email, phone, birthDate } = body;

    const clientExists = await this.clients.findByEmailAndProfessionalId(
      email,
      userId,
    );
    if (!id && clientExists) {
      throw new AppError('Cliente já cadastrado para o profissional.', 402);
    }

    if (id && clientExists && clientExists.id !== id) {
      throw new AppError('Cliente cadastrado com outro ID.', 402);
    }

    const user = await this.users.findByEmail({
      email,
    });

    if (!id) {
      const result = await this.clients.create({
        name,
        email,
        phone,
        birthDate,
        userId: user?.id,
        professional: { connect: { id: userId } },
      });
      return result;
    } else {
      const result = await this.clients.update(id, {
        name,
        email,
        phone,
        birthDate,
      });
      return result;
    }
  }
}
