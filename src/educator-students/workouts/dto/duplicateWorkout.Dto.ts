import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class DuplicateWorkoutDTO {
  @ApiProperty({
    type: [String],
    description:
      'Ids of the educator own students (1 to 20). Each gets a draft copy.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  studentIds: string[];
}
