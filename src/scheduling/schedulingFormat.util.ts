export function appUrl(path: string): string {
  return `${process.env.APP_URL ?? ''}${path}`;
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
