import { AuthGuard } from '@/auth/auth.guard';
import { UserRepository } from '@/repositories/users/user.repository';
import { AppError } from '@/utils/app.erro';
import { UploadService } from '@/utils/upload.service';
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

@ApiTags('User')
@Controller('profile')
@ApiBearerAuth('jwt')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(
    private user: UserRepository,

    private uploadService: UploadService,
  ) {}

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
    const existingUser = await this.user.getUserProfile(req.user.id);
    if (!existingUser) {
      throw new AppError('User not found', 402);
    }

    const {
      addressLine1,
      addressLine2,
      city,
      district,
      postalCode,
      region,
      birthDate,
      name,
      phone,
    } = body;

    const address = {
      addressLine1,
      addressLine2,
      city,
      district,
      postalCode,
      region,
    };

    let avatarUrl = existingUser.avatar;
    if (avatar) {
      avatarUrl = await this.uploadService.uploadImage(avatar);
      if (existingUser.avatar) {
        await this.uploadService.deleteImage(existingUser.avatar);
      }
    }

    const userBirthDate = birthDate ? new Date(birthDate) : null;

    const result = await this.user.updateUserProfile(
      req.user.id,
      {
        birthDate: userBirthDate,
        name,
        phone,
        avatar: avatarUrl,
      },
      address,
    );

    return result;
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
    const user = await this.user.getUserProfile(req.user.id);

    if (!user) {
      throw new AppError('User not found', 402);
    }

    const signedAvatarUrl = user.avatar
      ? await this.uploadService.getSignedUrl(user.avatar)
      : null;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      birthDate: user.birthDate,
      avatar: signedAvatarUrl,
      phone: user.phone ?? null,
      address: user.userAddresses
        ? {
            addressLine1: user.userAddresses.addressLine1,
            addressLine2: user.userAddresses.addressLine2,
            district: user.userAddresses.district,
            city: user.userAddresses.city,
            region: user.userAddresses.region,
            postalCode: user.userAddresses.postalCode,
          }
        : null,
    };
  }
}
