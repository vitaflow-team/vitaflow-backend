import { ApiProperty } from '@nestjs/swagger';
import { ProductType } from '@prisma/client';

// Response shape shared by password and Google sign-in: decorated for
// Swagger, never validated.
export class SignInResponseDTO {
  @ApiProperty({ example: 'cuid-user-456' })
  id: string;

  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: 'johndoe@example.com' })
  email: string;

  @ApiProperty({
    example: 'https://storage.googleapis.com/bucket/avatar.png',
    nullable: true,
    type: String,
  })
  avatar: string | null;

  @ApiProperty({ example: 'cuid-product-123', nullable: true, type: String })
  productId: string | null;

  @ApiProperty({ enum: ProductType, required: false })
  productType?: ProductType;

  @ApiProperty({ example: 'cuid-group-123', required: false })
  productGroupId?: string;

  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;
}
