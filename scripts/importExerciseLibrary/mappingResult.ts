// Either the mapped value or the reason the source entry cannot be imported.
export type MappingResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };
