export type ActivationSkipReason =
  | 'tax_id_missing'
  | 'already_billing'
  | 'no_active_plan'
  | 'gateway_failed';
