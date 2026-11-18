import { NotificationCategory } from '@prisma/client';
import { PushPayload } from './types/pushPayload';

export const PUSH_TITLE = 'Vitaflow';
export const PUSH_FALLBACK_BODY = 'Você tem uma nova notificação';
export const PUSH_HOME_URL = '/restrict';
export const PUSH_HELD_TAG = 'held';

// Generic on purpose (push-notifications ADR-004): a lock screen must never
// show message text, amounts, names, or health data.
const CATEGORY_BODY: Record<NotificationCategory, string> = {
  WORKOUT_REMINDER: 'Hora do seu treino',
  CONSULTATION_REMINDER: 'Você tem um atendimento em breve',
  MESSAGES: 'Você recebeu uma nova mensagem',
  BILLING: 'Você tem uma atualização de cobrança',
  PRODUCT_NEWS: 'Há novidades no Vitaflow',
  CONNECTION_REQUEST: 'Você tem uma nova solicitação de conexão',
  WORKOUT_PLAN: 'Seu plano de treino foi atualizado',
  SCHEDULE_CHANGE: 'Sua agenda foi alterada',
  ACADEMIA_ACTIVITY: 'Há uma nova atividade na academia',
  CHURN_RISK_ALERT: 'Você tem um novo alerta de engajamento',
  DIARY_REMINDER: 'Hora de registrar sua refeição',
  CHECKIN_ABSENCE: 'Sentimos sua falta na academia',
};

export function openNotificationUrl(notificationId: string): string {
  return `${PUSH_HOME_URL}/notifications/open/${notificationId}`;
}

export function buildPushPayload(notification: {
  id: string;
  category: NotificationCategory;
}): PushPayload {
  return {
    title: PUSH_TITLE,
    body: CATEGORY_BODY[notification.category] ?? PUSH_FALLBACK_BODY,
    url: openNotificationUrl(notification.id),
    tag: notification.id,
  };
}

export function buildGroupedPayload(count: number): PushPayload {
  const body =
    count === 1
      ? 'Você tem 1 nova notificação'
      : `Você tem ${count} novas notificações`;
  return {
    title: PUSH_TITLE,
    body,
    url: PUSH_HOME_URL,
    tag: PUSH_HELD_TAG,
  };
}
