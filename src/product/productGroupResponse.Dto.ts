import { ApiProperty } from '@nestjs/swagger';
import { ProductResponseDTO } from './productResponse.Dto';

export class ProductGroupResponseDTO {
  @ApiProperty({ example: 'cuid-group-123' })
  id: string;

  @ApiProperty({ example: 'Planos para alunos' })
  name: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [ProductResponseDTO] })
  products: ProductResponseDTO[];
}
