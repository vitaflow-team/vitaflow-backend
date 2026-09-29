export type AuditEvent = Record<string, string> & {
  event: string;
  timestamp: string;
};
