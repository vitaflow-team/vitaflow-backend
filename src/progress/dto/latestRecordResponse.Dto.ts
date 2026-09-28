import { ApiProperty } from '@nestjs/swagger';
import { MeasurementRecordResponseDTO } from './measurementRecordResponse.Dto';

export class LatestRecordResponseDTO {
  @ApiProperty({ type: MeasurementRecordResponseDTO, nullable: true })
  latest: MeasurementRecordResponseDTO | null;
}
