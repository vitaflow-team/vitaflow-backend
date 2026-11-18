// The two ownership columns of a Client row: for an independent student
// `professionalId` is the owner; for a gym student `academiaId` is, and
// `professionalId` is only the currently assigned educator.
export interface ClientScope {
  professionalId: string | null;
  academiaId: string | null;
}
