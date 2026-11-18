// One payment of a gateway account as the platform's local payment table
// needs it. `status` is the gateway's own value (never mapped here) and
// `deleted` tells a payment that was removed at the gateway apart from a live
// one. Dates are calendar dates (YYYY-MM-DD).
export interface GatewayPaymentItem {
  id: string;
  customer: string;
  subscription: string | null;
  valueCents: number;
  status: string;
  dueDate: string;
  paymentDate: string | null;
  deleted: boolean;
}
