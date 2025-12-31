import { AuthGuard } from '@/auth/auth.guard';
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
  constructor(private service: ClientRegisterService) {}

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
    return await this.service.getClients(req.user.id);
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
    return await this.service.getClientById(id, req.user.id);
  }

  @ApiOperation({
    summary: 'Delete Client by ID',
    description: 'Delete client by ID.',
  })
  @ApiResponse({
    status: 200,
    description: 'Client successfully deleted.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized access.',
  })
  @Delete(':id')
  async deleteClientById(
    @Param('id') id: string,
    @Request() req: { user: { id: string } },
  ) {
    return await this.service.deleteClientById(id, req.user.id);
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
    return await this.service.postRegister(body, req.user.id);
  }
}
