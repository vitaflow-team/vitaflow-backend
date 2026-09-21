import { deriveExpiry } from './subscriptionExpiry';

const PERIOD_END = new Date('2026-10-18T03:00:00.000Z');
const CANCEL_AT = new Date('2026-10-10T03:00:00.000Z');

const paid = {
  status: 'active',
  cancelAt: null,
  periodEnd: PERIOD_END,
  planPrice: 19.9,
};

describe('plan expiry — deriveExpiry', () => {
  // UT-009
  it('renews at the period end for an active paid plan', () => {
    expect(deriveExpiry(paid)).toEqual({
      expiresAt: PERIOD_END,
      autoRenew: true,
    });
  });

  // UT-010
  it('expires at the cancellation date, which wins over the period end', () => {
    expect(deriveExpiry({ ...paid, cancelAt: CANCEL_AT })).toEqual({
      expiresAt: CANCEL_AT,
      autoRenew: false,
    });
  });

  // UT-011
  it.each([['canceled'], ['incomplete']])(
    'reports no expiry for status %s even with dates stored',
    (status) => {
      expect(deriveExpiry({ ...paid, status, cancelAt: CANCEL_AT })).toEqual({
        expiresAt: null,
        autoRenew: false,
      });
    },
  );

  // UT-011
  it('reports no expiry for a null status even with dates stored', () => {
    expect(
      deriveExpiry({ ...paid, status: null, cancelAt: CANCEL_AT }),
    ).toEqual({ expiresAt: null, autoRenew: false });
  });

  // UT-012 — an older subscription with no stored period end simply shows
  // no date; it is still renewing, so it is not an error state.
  it('still renews with no date when no period end is stored', () => {
    expect(deriveExpiry({ ...paid, periodEnd: null })).toEqual({
      expiresAt: null,
      autoRenew: true,
    });
  });

  // UT-013
  it('reports no expiry for Gratuito however stale its columns are', () => {
    expect(
      deriveExpiry({
        status: 'active',
        cancelAt: CANCEL_AT,
        periodEnd: PERIOD_END,
        planPrice: 0,
      }),
    ).toEqual({ expiresAt: null, autoRenew: false });
  });

  // UT-014
  it.each([['trialing'], ['past_due']])(
    'treats status %s exactly like active',
    (status) => {
      expect(deriveExpiry({ ...paid, status })).toEqual({
        expiresAt: PERIOD_END,
        autoRenew: true,
      });
      expect(deriveExpiry({ ...paid, status, cancelAt: CANCEL_AT })).toEqual({
        expiresAt: CANCEL_AT,
        autoRenew: false,
      });
    },
  );

  // UT-012 — the server-to-server subscription endpoint has no product, so
  // a null price must not be mistaken for Gratuito.
  it('treats an unknown plan price as paid', () => {
    expect(deriveExpiry({ ...paid, planPrice: null })).toEqual({
      expiresAt: PERIOD_END,
      autoRenew: true,
    });
  });
});
