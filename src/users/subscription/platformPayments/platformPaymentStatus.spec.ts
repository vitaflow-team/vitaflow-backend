import { PlatformPaymentStatus } from '@prisma/client';
import { mapPlatformPaymentStatus } from './platformPaymentStatus';

describe('mapPlatformPaymentStatus (UT-105)', () => {
  it.each([
    ['PENDING', false, PlatformPaymentStatus.PENDING],
    ['OVERDUE', false, PlatformPaymentStatus.OVERDUE],
    ['RECEIVED', false, PlatformPaymentStatus.PAID],
    ['CONFIRMED', false, PlatformPaymentStatus.PAID],
    ['RECEIVED_IN_CASH', false, PlatformPaymentStatus.PAID],
    ['REFUNDED', false, PlatformPaymentStatus.REFUNDED],
    ['PENDING', true, PlatformPaymentStatus.CANCELED],
    ['RECEIVED', true, PlatformPaymentStatus.CANCELED],
  ])('maps %s (deleted: %s) to %s', (raw, deleted, expected) => {
    expect(mapPlatformPaymentStatus(raw, deleted)).toBe(expected);
  });

  it.each(['CHARGEBACK_DISPUTE', 'REFUND_IN_PROGRESS', 'SOMETHING_NEW'])(
    'leaves %s unmapped so the row keeps what it had',
    (raw) => {
      expect(mapPlatformPaymentStatus(raw)).toBeNull();
    },
  );
});
