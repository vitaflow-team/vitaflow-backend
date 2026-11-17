import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { ActivateBillingItemDTO } from './activateBillingItem.Dto';

// The size limits (1 to 200) are the service's, so an empty or oversized
// selection answers with its own code, not a generic validation error.
export class ActivateBillingDTO {
  @ApiProperty({ type: [ActivateBillingItemDTO] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActivateBillingItemDTO)
  items: ActivateBillingItemDTO[];
}
