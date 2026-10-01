import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class PollMessagesDto {
  @ApiProperty({
    description: 'Only messages created after this message id.',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  after?: string;
}
