import { ApiProperty } from '@nestjs/swagger';
import { ViewAsTargetKind } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StartViewAsDTO {
  @ApiProperty({ enum: ViewAsTargetKind })
  @IsEnum(ViewAsTargetKind)
  targetKind: ViewAsTargetKind;

  @ApiProperty({
    description: 'Id of the target Users or AcademiaStaffMember row.',
  })
  @IsString()
  @IsNotEmpty()
  targetId: string;

  @ApiProperty({
    description: 'Why this access is needed (mandatory, US-003).',
  })
  @IsString()
  @IsNotEmpty({ message: 'Informe o motivo do acesso.' })
  @MaxLength(500)
  reason: string;
}
