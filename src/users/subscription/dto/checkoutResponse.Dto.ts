import { ApiProperty } from '@nestjs/swagger';

export class CheckoutResponseDTO {
  @ApiProperty({ example: 'https://asaas.com/checkoutSession/show?id=abc' })
  link: string;
}
