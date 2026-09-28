import { Product, Users } from '@prisma/client';

export type UserWithProduct = Users & { product: Product | null };
