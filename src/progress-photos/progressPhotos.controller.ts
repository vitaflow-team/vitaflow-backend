import { AuthGuard } from '@/auth/auth.guard';
import { PremiumGuard } from '@/common/guards/premium.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CompareQueryDto } from './dto/compareQuery.Dto';
import { PhotoAngleQueryDto } from './dto/photoAngleQuery.Dto';
import { UploadPhotoDto } from './dto/uploadPhoto.Dto';
import {
  CompareResultEntity,
  ConsentStatusEntity,
  ProgressPhotoEntity,
  SignedUrlEntity,
} from './progressPhoto.entity';
import { PROGRESS_PHOTO_UPLOAD_OPTIONS } from './progressPhotoUpload';
import { ProgressPhotosService } from './progressPhotos.service';

// Premium gating applies before everything else in this feature, including
// the consent step itself (PRD Business Rules), so it is a class-level
// guard on every route without exception — unlike the AI Workout
// Generator's conditional regeneration-only gate.
@ApiTags('Progress Photos')
@Controller('progress-photos')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard, PremiumGuard)
export class ProgressPhotosController {
  constructor(private readonly service: ProgressPhotosService) {}

  @ApiOperation({
    summary: "Whether the user has given this feature's consent",
  })
  @ApiResponse({ status: 200, type: ConsentStatusEntity })
  @ApiResponse({ status: 402, description: 'Free-tier user.' })
  @Get('consent')
  async getConsent(
    @Request() req: AuthenticatedRequest,
  ): Promise<ConsentStatusEntity> {
    const consented = await this.service.hasConsented(req.user.id);
    return { consented };
  }

  @ApiOperation({ summary: "Grant this feature's dedicated LGPD consent" })
  @ApiResponse({ status: 204, description: 'Sem corpo de resposta.' })
  @ApiResponse({ status: 402, description: 'Free-tier user.' })
  @HttpCode(204)
  @Post('consent')
  async postConsent(@Request() req: AuthenticatedRequest): Promise<void> {
    await this.service.giveConsent(req.user.id);
  }

  @ApiOperation({ summary: 'Upload a progress photo for a given angle' })
  @ApiResponse({ status: 201, type: ProgressPhotoEntity })
  @ApiResponse({ status: 400, description: 'Formato de imagem inválido.' })
  @ApiResponse({
    status: 403,
    description: 'Consentimento desta funcionalidade ainda não concedido.',
  })
  @ApiResponse({ status: 402, description: 'Free-tier user.' })
  @ApiResponse({ status: 413, description: 'Imagem maior que 8 MB.' })
  @UseInterceptors(FileInterceptor('file', PROGRESS_PHOTO_UPLOAD_OPTIONS))
  @Post()
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadPhotoDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ProgressPhotoEntity> {
    return await this.service.upload(req.user.id, dto.angle, file);
  }

  @ApiOperation({
    summary: "List a user's photos for one angle, each with a fresh signed URL",
  })
  @ApiResponse({ status: 200, type: [ProgressPhotoEntity] })
  @Get()
  async listByAngle(
    @Query() query: PhotoAngleQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ProgressPhotoEntity[]> {
    return await this.service.listByAngle(req.user.id, query.angle);
  }

  @ApiOperation({
    summary: 'Compare two photos of the same angle side by side',
  })
  @ApiResponse({ status: 200, type: CompareResultEntity })
  @ApiResponse({
    status: 400,
    description: 'As duas fotos não são do mesmo ângulo.',
  })
  @ApiResponse({ status: 404, description: 'Foto não encontrada.' })
  @Get('compare')
  async compare(
    @Query() query: CompareQueryDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<CompareResultEntity> {
    return await this.service.compare(req.user.id, query.a, query.b);
  }

  // Not in the TechSpec's own API Endpoints table, but US-007/UT-016/UT-017
  // explicitly assign `getSignedUrlFor` as this story's backing contract,
  // and US-007 has no other HTTP path to reach it — added per the Authority
  // ladder (assigned test IDs pin concrete form over an incomplete sibling
  // table), the same resolution pattern used for Food Diary's own missing
  // `POST /profile` endpoint.
  @ApiOperation({ summary: 'View one photo at full size via a signed URL' })
  @ApiResponse({ status: 200, type: SignedUrlEntity })
  @ApiResponse({ status: 404, description: 'Foto não encontrada.' })
  @Get(':id')
  async getOne(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<SignedUrlEntity> {
    const signedUrl = await this.service.getSignedUrlFor(req.user.id, id);
    return { signedUrl };
  }

  @ApiOperation({ summary: 'Delete a progress photo (object + row)' })
  @ApiResponse({ status: 204, description: 'Removida. Sem corpo de resposta.' })
  @ApiResponse({ status: 404, description: 'Foto não encontrada.' })
  @HttpCode(204)
  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.service.delete(req.user.id, id);
  }
}
