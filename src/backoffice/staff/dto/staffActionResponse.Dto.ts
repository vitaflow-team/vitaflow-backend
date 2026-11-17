import { ApiProperty } from '@nestjs/swagger';

// Acknowledgement returned by the staff actions that have no other payload.
// Decorated for Swagger, never validated.
export class StaffActionResponseDTO {
  @ApiProperty({ example: true })
  ok: true;
}
