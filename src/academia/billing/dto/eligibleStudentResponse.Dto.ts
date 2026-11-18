export interface EligibleStudentResponseDTO {
  clientId: string;
  name: string;
  planName: string;
  // What the first fee costs by default: the plan price, in cents.
  amountCents: number;
  hasTaxId: boolean;
}
