import { ApiProperty } from '@nestjs/swagger';
import { PhotoAngle } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UploadPhotoDto {
  @ApiProperty({ enum: PhotoAngle })
  @IsEnum(PhotoAngle)
  angle: PhotoAngle;
}
