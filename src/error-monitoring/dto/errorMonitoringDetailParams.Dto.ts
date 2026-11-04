import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class ErrorMonitoringDetailParamsDTO {
  @ApiProperty({ enum: ['backend', 'frontend'] })
  @IsIn(['backend', 'frontend'])
  app!: 'backend' | 'frontend';

  @ApiProperty()
  @IsString()
  issueId!: string;
}
