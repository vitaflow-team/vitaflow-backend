import { normalizeNotificationLink } from './normalizeNotificationLink';

const APP_URL = 'https://app.vitaflow.com';

describe('normalizeNotificationLink', () => {
  it('UT-001 turns an absolute link on APP_URL into an in-app path', () => {
    expect(
      normalizeNotificationLink(`${APP_URL}/restrict/messages`, APP_URL),
    ).toBe('/restrict/messages');
  });

  it('UT-002 keeps a relative link unchanged', () => {
    expect(
      normalizeNotificationLink('/restrict/workouts?plano=educador', APP_URL),
    ).toBe('/restrict/workouts?plano=educador');
  });

  it('UT-003 rejects a link on a foreign host', () => {
    expect(
      normalizeNotificationLink(
        'https://evil.example/restrict/messages',
        APP_URL,
      ),
    ).toBeNull();
  });

  it.each(['//evil.example/restrict', 'javascript:alert(1)'])(
    'UT-004 rejects the unsafe link %s',
    (link) => {
      expect(normalizeNotificationLink(link, APP_URL)).toBeNull();
    },
  );

  it.each([undefined, null, '', '/signin', '/restrictfoo', '/other'])(
    'UT-005 returns null for %p',
    (link) => {
      expect(normalizeNotificationLink(link, APP_URL)).toBeNull();
    },
  );

  it('UT-005 accepts the bare restricted area path', () => {
    expect(normalizeNotificationLink('/restrict', APP_URL)).toBe('/restrict');
  });

  it('UT-006 keeps a relative link when APP_URL is unset', () => {
    expect(normalizeNotificationLink('/restrict/scheduling', undefined)).toBe(
      '/restrict/scheduling',
    );
  });
});
