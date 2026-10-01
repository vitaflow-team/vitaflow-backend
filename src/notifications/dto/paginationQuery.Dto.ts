import { ApiProperty } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class PaginationQueryDto {
  @ApiProperty({
    description:
      'Page number, starting at 1. Each page holds 50 notifications.',
    required: false,
    example: 1,
  })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) => {
    const queryValue = value as unknown;
    return typeof queryValue === 'string' && /^\d+$/.test(queryValue)
      ? Number(queryValue)
      : queryValue;
  })
  @IsInt()
  @Min(1)
  page?: number;
}
