import { AuthGuard } from '@/auth/auth.guard';
import {
  Body,
  Controller,
  Get,
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
import { ProfileDTO } from './profile.Dto';
import { ProfileService } from './profile.service';

@ApiTags('User')
@Controller('profile')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private service: ProfileService) {}

  @ApiOperation({
    summary: 'Update User Profile',
    description: 'Updates the user profile with the provided information.',
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
  @UseInterceptors(FileInterceptor('avatar'))
  async postProfile(
    @UploadedFile() avatar: Express.Multer.File,
    @Body() body: ProfileDTO,
    @Request() req: { user: { id: string } },
  ) {
    return await this.service.postProfile(avatar, body, req.user.id);
  }

  @ApiOperation({
    summary: 'Get User Profile',
    description: 'Returns the authenticated user profile.',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile update successfully.',
    type: ProfileDTO,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized user.',
  })
  @ApiResponse({
    status: 402,
    description: 'User not found.',
  })
  @Get()
  async getProfile(@Request() req: { user: { id: string } }) {
    return await this.service.getProfile(req.user.id);
  }
}
