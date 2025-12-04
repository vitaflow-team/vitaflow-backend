import { AuthGuard } from '@/auth/auth.guard';
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
  constructor(private user: UserRepository) {}

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
  @Post('profile')
  async postProfile(@Body() body: ProfileDTO, @Request() req) {
    const { address, birthDate, name, avatar, phone } = body;

    const userBirthDate = birthDate ? new Date(birthDate) : null;

    const result = await this.user.updateUserProfile(
      req.user.id,
      {
        birthDate: userBirthDate,
        name,
        avatar,
        phone,
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
  @Get('profile')
  async getProfile(@Request() req) {
    const user = await this.user.getUserProfile(req.user.id);

    if (!user) {
      throw new AppError('User not found', 402);
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      birthDate: user.birthDate,
      avatar: user.avatar ?? null,
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
