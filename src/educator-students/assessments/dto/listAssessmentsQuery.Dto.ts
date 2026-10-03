import { ApiProperty } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class ListAssessmentsQueryDTO {
  @ApiProperty({ required: false, minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const raw = value as unknown;
    return typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
  })
  @IsInt()
  @Min(1)
  page?: number;
}
