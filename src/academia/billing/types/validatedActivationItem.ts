// An activation item whose due day and amount passed validation.
export interface ValidatedActivationItem {
  clientId: string;
  dueDay: number;
  amountCents: number | null;
}
