import { ProductType } from '@prisma/client';

export function toProductType(value: string): ProductType {
  switch (value) {
    case ProductType.USER:
      return ProductType.USER;
    case ProductType.NUTRITIONIST:
      return ProductType.NUTRITIONIST;
    case ProductType.PHYSICAL_EDUCATOR:
      return ProductType.PHYSICAL_EDUCATOR;
    default:
      throw new Error(`Unknown product type: ${JSON.stringify(value)}`);
  }
}
