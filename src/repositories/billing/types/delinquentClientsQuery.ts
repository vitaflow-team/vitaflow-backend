export interface DelinquentClientsQuery {
  ownerId: string;
  today: string;
  limit: number;
  offset: number;
}
