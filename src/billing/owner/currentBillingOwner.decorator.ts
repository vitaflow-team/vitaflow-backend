import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { BillingOwner } from './types/billingOwner';
import type { BillingOwnerRequest } from './types/billingOwnerRequest';

// The billing owner BillingOwnerGuard resolved for this request.
export const CurrentBillingOwner = createParamDecorator(
  (_data: unknown, context: ExecutionContext): BillingOwner =>
    context.switchToHttp().getRequest<BillingOwnerRequest>().billingOwner,
);
