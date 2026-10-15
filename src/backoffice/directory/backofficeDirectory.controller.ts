import { AuthGuard } from '@/auth/auth.guard';
import { BackofficeGuard } from '@/common/guards/backoffice.guard';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BackofficeDirectoryService } from './backofficeDirectory.service';
import { DirectoryListResult } from './backofficeDirectoryMerge.util';
import { ListDirectoryQueryDTO } from './dto/listDirectory.Dto';

@ApiTags('Backoffice directory')
@ApiBearerAuth('jwt')
@Controller('backoffice/accounts')
@UseGuards(AuthGuard, BackofficeGuard)
export class BackofficeDirectoryController {
  constructor(private readonly directory: BackofficeDirectoryService) {}

  @ApiOperation({
    summary:
      'Search every account on the platform (US-001, US-002, US-013, US-014)',
  })
  @Get()
  async search(
    @Query() query: ListDirectoryQueryDTO,
  ): Promise<DirectoryListResult> {
    return await this.directory.search({
      search: query.search,
      type: query.type,
      page: query.page ?? 1,
    });
  }
}
