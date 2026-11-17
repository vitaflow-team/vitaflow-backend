import { PlatformPaymentStatus } from '@prisma/client';

// What a gateway payment status means for the platform panel (ADR-006). A
// removed payment is CANCELED whatever its last status was. A status the panel
// has no figure for (a chargeback in dispute, a refund still in progress) maps
// to null: the row keeps what it had until the gateway settles.
export function mapPlatformPaymentStatus(
  rawStatus: string,
  deleted = false,
): PlatformPaymentStatus | null {
  if (deleted) return PlatformPaymentStatus.CANCELED;
  switch (rawStatus) {
    case 'PENDING':
      return PlatformPaymentStatus.PENDING;
    case 'OVERDUE':
      return PlatformPaymentStatus.OVERDUE;
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
      return PlatformPaymentStatus.PAID;
    case 'REFUNDED':
      return PlatformPaymentStatus.REFUNDED;
    default:
      return null;
  }
}
