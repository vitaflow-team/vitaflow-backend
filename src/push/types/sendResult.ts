export type SendResult =
  | { ok: true }
  | { ok: false; gone: boolean; status?: number };
