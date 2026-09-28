import { AuthGuard } from '@/auth/auth.guard';
import type { AuthenticatedRequest } from '@/common/types/authenticatedRequest';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
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
import { AVATAR_UPLOAD_OPTIONS } from './avatarUpload';
import { ProfileDTO } from './profile.Dto';
import { ProfileResponseDTO } from './profileResponse.Dto';
import { ProfileService } from './profile.service';
import { ProfileUpdateResponseDTO } from './profileUpdateResponse.Dto';

@ApiTags('User')
@Controller('profile')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  @ApiOperation({
    summary: 'Update User Profile',
    description: 'Updates the user profile with the provided information.',
  })
  @ApiResponse({
    status: 201,
    description: 'User profile updated successfully.',
    type: ProfileUpdateResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description: 'Error updating user profile.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized access.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found.',
  })
  @ApiResponse({
    status: 413,
    description: 'Avatar larger than 2 MB.',
  })
  @Post()
  @UseInterceptors(FileInterceptor('avatar', AVATAR_UPLOAD_OPTIONS))
  async postProfile(
    @UploadedFile() avatar: Express.Multer.File,
    @Body() body: ProfileDTO,
    @Request() req: AuthenticatedRequest,
  ): Promise<ProfileUpdateResponseDTO> {
    return await this.service.postProfile(avatar, body, req.user.id);
  }

  @ApiOperation({
    summary: 'Get User Profile',
    description: 'Returns the authenticated user profile.',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile successfully retrieved.',
    type: ProfileResponseDTO,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized user.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found.',
  })
  @Get()
  async getProfile(
    @Request() req: AuthenticatedRequest,
  ): Promise<ProfileResponseDTO> {
    return await this.service.getProfile(req.user.id);
  }

  @ApiOperation({
    summary: 'Delete the authenticated user account',
    description:
      'Erases every record owned by the requester in one transaction and ' +
      'then removes an app-hosted avatar file. Acts on the authenticated ' +
      'user only — no identifier is accepted from the request.',
  })
  @ApiResponse({
    status: 204,
    description: 'Account deleted successfully.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized user.',
  })
  @ApiResponse({
    status: 404,
    description: 'User not found.',
  })
  @Delete()
  @HttpCode(204)
  async deleteProfile(@Request() req: AuthenticatedRequest): Promise<void> {
    await this.service.deleteProfile(req.user.id);
  }
}
