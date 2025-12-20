import { AuthGuard } from '@/auth/auth.guard';
import { ClientsRepository } from '@/repositories/clients/clients.repository';
import { AppError } from '@/utils/app.erro';
import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
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
  constructor(private clients: ClientsRepository) {}

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
  @Post('register')
  async postRegister(@Body() body: ClientRegisterDTO, @Request() req) {
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

    const result = await this.clients.create({
      name,
      email,
      phone,
      birthDate,
      professional: { connect: { id: req.user.id } },
    });

    return result;
  }
}
