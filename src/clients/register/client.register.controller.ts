import { AuthGuard } from '@/auth/auth.guard';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import {
  Body,
  Controller,
  Get,
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
    summary: 'Update User Profile',
    description: 'Updates the user profile with the provided information.',
  })
  @ApiBody({
    type: ClientRegisterDTO,
  })
  @ApiResponse({
    status: 201,
    description: 'User profile updated successfully.',
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
    const { name, email, phone, birthDate } = body;

    const clientExists = await this.clients.findByEmailAndProfessionalId(
      email,
      req.user.id,
    );
    if (clientExists) {
      throw new AppError(
        'Client already registered for the professional.',
        402,
      );
    }

    const user = await this.users.findByEmail({
      email,
    });

    const result = await this.clients.create({
      name,
      email,
      phone,
      birthDate,
      userId: user?.id,
      professional: { connect: { id: req.user.id } },
    });

    return result;
  }
}
