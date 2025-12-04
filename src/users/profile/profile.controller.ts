import { AuthGuard } from '@/auth/auth.guard';
import { UserRepository } from '@/repositories/users/user.repository';
import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
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
}
