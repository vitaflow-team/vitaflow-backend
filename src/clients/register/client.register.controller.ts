import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Delete,
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
import { ClientRegisterService } from './client.register.service';

@ApiTags('Clients')
@Controller('clients')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class ClientRegisterController {
  constructor(private readonly service: ClientRegisterService) {}

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
  async getClients(
    @Request() req: AuthenticatedRequest,
  ): Promise<ClientEntity[]> {
    return await this.service.getClients(req.user.id);
  }

  @ApiOperation({
    summary: 'Get Client by ID',
    description:
      'Get client by ID. The body is empty when no client has that id.',
  })
  @ApiResponse({
    status: 200,
    description: 'Client successfully retrieved.',
    type: ClientEntity,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized access.',
  })
  @Get(':id')
  async getClientById(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<ClientEntity | null> {
    return await this.service.getClientById(id, req.user.id);
  }

  @ApiOperation({
    summary: 'Delete Client by ID',
    description: 'Delete client by ID.',
  })
  @ApiResponse({
    status: 200,
    description: 'Client successfully deleted. No response body.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized access.',
  })
  @Delete(':id')
  async deleteClientById(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    return await this.service.deleteClientById(id, req.user.id);
  }

  @ApiOperation({
    summary: 'Create or update a client',
    description:
      'Creates a new client for the professional, or updates an owned client when an id is sent.',
  })
  @ApiBody({
    type: ClientRegisterDTO,
  })
  @ApiResponse({
    status: 201,
    description: 'Client saved successfully.',
    type: ClientEntity,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid client data.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized access.',
  })
  @ApiResponse({
    status: 404,
    description: 'Client not found for this professional.',
  })
  @ApiResponse({
    status: 409,
    description: 'Client already registered for this professional.',
  })
  @Post()
  async postRegister(
    @Body() body: ClientRegisterDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<ClientEntity> {
    return await this.service.postRegister(body, req.user.id);
  }
}
