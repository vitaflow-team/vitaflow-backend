import { ApiProperty } from '@nestjs/swagger';

export class StreakSummaryDTO {
  @ApiProperty({ example: 5 })
  currentDays: number;

  @ApiProperty({ example: 12 })
  personalBestDays: number;
}
