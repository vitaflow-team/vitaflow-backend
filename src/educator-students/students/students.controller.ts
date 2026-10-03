import { AuthGuard } from '@/auth/auth.guard';
import { PhysicalEducatorGuard } from '@/common/guards/physicalEducator.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccountLookupThrottlerGuard } from './accountLookupThrottler.guard';
import { AccountLookupQueryDTO } from './dto/accountLookupQuery.Dto';
import { CreateStudentDTO } from './dto/createStudent.Dto';
import { ListStudentsQueryDTO } from './dto/listStudentsQuery.Dto';
import {
  AccountLookupResponseDTO,
  StudentListResponseDTO,
  StudentResponseDTO,
} from './dto/studentResponse.Dto';
import { UpdateStudentDTO } from './dto/updateStudent.Dto';
import { StudentsService } from './students.service';

export const ACCOUNT_LOOKUP_LIMIT = 10;
export const ACCOUNT_LOOKUP_WINDOW_MS = 60_000;

@ApiTags('Educator students')
@Controller('educator/students')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, PhysicalEducatorGuard)
export class StudentsController {
  constructor(private readonly service: StudentsService) {}

  @ApiOperation({
    summary: "List the educator's students",
    description:
      'Ordered by name, 50 per page. `search` matches name or e-mail, ignoring case and accents, over all students.',
  })
  @ApiResponse({ status: 200, description: 'Students listed.' })
  @ApiResponse({ status: 400, description: 'Invalid query.' })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @ApiResponse({ status: 403, description: 'Not a physical educator.' })
  @Get()
  async list(
    @Query() query: ListStudentsQueryDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<StudentListResponseDTO> {
    return await this.service.list(req.user.id, query);
  }

  @ApiOperation({
    summary: 'Find a confirmed account by e-mail',
    description:
      "Returns only whether a confirmed account exists and its holder's name. Limited to 10 requests per minute per educator.",
  })
  @ApiResponse({ status: 200, description: '`{ found, name }`.' })
  @ApiResponse({ status: 400, description: 'Invalid e-mail.' })
  @ApiResponse({ status: 429, description: 'Too many lookups.' })
  @UseGuards(AccountLookupThrottlerGuard)
  @Throttle({
    default: { limit: ACCOUNT_LOOKUP_LIMIT, ttl: ACCOUNT_LOOKUP_WINDOW_MS },
  })
  @Get('account-lookup')
  async lookupAccount(
    @Query() query: AccountLookupQueryDTO,
  ): Promise<AccountLookupResponseDTO> {
    return await this.service.lookupAccount(query.email);
  }

  @ApiOperation({
    summary: 'Register a student, linking an existing confirmed account or not',
  })
  @ApiResponse({ status: 201, description: 'Student registered.' })
  @ApiResponse({
    status: 400,
    description: 'Invalid data or self registration.',
  })
  @ApiResponse({ status: 404, description: 'No confirmed account to link.' })
  @ApiResponse({
    status: 409,
    description:
      'Already registered (`student_already_registered`) or a confirmed account exists (`account_exists`).',
  })
  @Post()
  async create(
    @Body() dto: CreateStudentDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<StudentResponseDTO> {
    return await this.service.create(req.user.id, dto);
  }

  @ApiOperation({ summary: "A student's record header and overview" })
  @ApiResponse({ status: 200, description: 'Student found.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @Get(':id')
  async get(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<StudentResponseDTO> {
    return await this.service.get(req.user.id, id);
  }

  @ApiOperation({ summary: "Edit a student's registration data" })
  @ApiResponse({ status: 200, description: 'Student updated.' })
  @ApiResponse({ status: 400, description: 'Invalid data or locked e-mail.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @ApiResponse({ status: 409, description: 'Duplicate or account exists.' })
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStudentDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<StudentResponseDTO> {
    return await this.service.update(req.user.id, id, dto);
  }

  @ApiOperation({
    summary: 'Remove a student and all their assessments',
  })
  @ApiResponse({ status: 204, description: 'Student removed.' })
  @ApiResponse({ status: 404, description: 'Student not found.' })
  @HttpCode(204)
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.remove(req.user.id, id);
  }
}
