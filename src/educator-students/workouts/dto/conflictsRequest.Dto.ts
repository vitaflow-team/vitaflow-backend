import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { CONFLICT_IDS_MAX } from '../workoutLimits.constants';

export class ConflictsRequestDTO {
  @ApiProperty({
    type: [String],
    description: 'Library exercise ids (1 to 100).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CONFLICT_IDS_MAX)
  @IsUUID(undefined, { each: true })
  exerciseIds: string[];
}
