import { NotificationCategory } from '@prisma/client';
import {
  buildGroupedPayload,
  buildPushPayload,
  PUSH_TITLE,
} from './pushContent';

describe('pushContent', () => {
  it.each(Object.values(NotificationCategory))(
    'UT-007 gives %s a generic Portuguese body',
    (category) => {
      const payload = buildPushPayload({ id: 'n1', category });

      expect(payload.title).toBe(PUSH_TITLE);
      expect(payload.body.length).toBeGreaterThan(0);
      expect(payload.url).toBe('/restrict/notifications/open/n1');
      expect(payload.tag).toBe('n1');
    },
  );

  it('UT-008 never carries amounts or names from the notification text', () => {
    // buildPushPayload only receives id and category, so message text such as
    // "Fatura de R$ 99,90 de João Silva" cannot reach the body.
    const bodies = Object.values(NotificationCategory).map(
      (category) => buildPushPayload({ id: 'n1', category }).body,
    );

    for (const body of bodies) {
      expect(body).not.toMatch(/\d/);
      expect(body).not.toMatch(/João|Silva|R\$/);
    }
  });

  it('UT-009 builds the grouped body from the count', () => {
    expect(buildGroupedPayload(3)).toEqual({
      title: PUSH_TITLE,
      body: 'Você tem 3 novas notificações',
      url: '/restrict',
      tag: 'held',
    });
    expect(buildGroupedPayload(2).body).toBe('Você tem 2 novas notificações');
  });
});
