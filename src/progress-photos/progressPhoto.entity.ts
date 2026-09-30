import { ApiProperty } from '@nestjs/swagger';
import { PhotoAngle } from '@prisma/client';

// Never includes `storageFilename` — only ever a freshly-signed, short-lived
// URL, per ADR-001. No response type in this feature may expose the raw
// object key or a public bucket URL.
export class ProgressPhotoEntity {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: PhotoAngle })
  angle: PhotoAngle;

  @ApiProperty({ description: 'Freshly generated, short-lived.' })
  signedUrl: string;

  @ApiProperty()
  takenAt: Date;

  @ApiProperty({
    required: false,
    description:
      'Present only on the first upload after a prior photo exists for the ' +
      'same angle (IT-002) — the frontend renders it as the capture-guide overlay.',
  })
  previousPhotoUrl?: string;
}

export class ConsentStatusEntity {
  @ApiProperty()
  consented: boolean;
}

export class SignedUrlEntity {
  @ApiProperty({ description: 'Freshly generated, short-lived.' })
  signedUrl: string;
}

export class CompareResultEntity {
  @ApiProperty({ type: ProgressPhotoEntity })
  a: ProgressPhotoEntity;

  @ApiProperty({ type: ProgressPhotoEntity })
  b: ProgressPhotoEntity;
}
