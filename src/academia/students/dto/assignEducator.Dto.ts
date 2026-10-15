import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AssignEducatorDTO {
  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Educator currently employed by this academia to assign, or null to clear the assignment (gym-foundation ADR-009).',
    example: 'educator-uuid-string',
  })
  @IsOptional()
  @IsString()
  professionalId: string | null;
}
