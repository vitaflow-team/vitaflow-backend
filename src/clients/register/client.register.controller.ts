import { AuthGuard } from '@/auth/auth.guard';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ClientEntity } from '../client.entity';
import { ClientRegisterDTO } from './client.register.Dto';

@ApiTags('Clients')
@Controller('clients')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class ClientRegisterController {
  constructor(
    private clients: ClientsRepository,

    private users: UserRepository,
  ) {}

  @ApiOperation({
    summary: 'Get Clients',
    description: 'Get clients for the professional.',
  })
  @ApiResponse({
    status: 200,
    description: 'Clients successfully retrieved.',
    type: [ClientEntity],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized access.',
  })
  @Get()
  async getClients(@Request() req: { user: { id: string } }) {
    const result = await this.clients.getAllByProfessionalId(req.user.id);

    return result;
  }

  @ApiOperation({
    summary: 'Get Client by ID',
    description: 'Get client by ID.',
  })
  @ApiResponse({
    status: 200,
    description: 'Client successfully retrieved.',
    type: ClientEntity || null,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized access.',
  })
  @Get(':id')
  async getClientById(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    const client = await this.clients.getClientById(id);

    if (client && client.professionalId !== req.user.id) {
      throw new AppError('Unauthorized access.', 401);
    }

    return client;
  }

  @ApiOperation({
    summary: 'Create new client by User',
    description: 'Create new client by User.',
  })
  @ApiBody({
    type: ClientRegisterDTO,
  })
  @ApiResponse({
    status: 201,
    description: 'User profile updated successfully.',
    type: ClientEntity,
  })
  @ApiResponse({
    status: 400,
    description: 'Error updating user profile.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized access.',
  })
  @Post()
  async postRegister(
    @Body() body: ClientRegisterDTO,
    @Request() req: { user: { id: string } },
  ) {
    const { id, name, email, phone, birthDate } = body;

    const clientExists = await this.clients.findByEmailAndProfessionalId(
      email,
      req.user.id,
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
        professional: { connect: { id: req.user.id } },
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
