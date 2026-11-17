import type { DelinquentRowDTO } from './delinquentRow.Dto';

export interface DelinquentsResponseDTO {
  items: DelinquentRowDTO[];
  page: number;
  pageSize: 20;
  total: number;
}
