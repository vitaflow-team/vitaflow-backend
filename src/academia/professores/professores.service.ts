import { ProfessoresRepository } from '@/repositories/academia/professores.repository';
import { Injectable } from '@nestjs/common';
import {
  mergeProfessoresList,
  type ProfessoresListResult,
} from './professoresMerge.util';

export const PROFESSORES_PAGE_SIZE = 50;

export interface ProfessoresListQuery {
  academiaId: string;
  search?: string;
  page: number;
}

@Injectable()
export class ProfessoresService {
  constructor(private readonly professores: ProfessoresRepository) {}

  async list(query: ProfessoresListQuery): Promise<ProfessoresListResult> {
    const [activeRows, pendingRows] = await Promise.all([
      this.professores.searchActiveByAcademia(query.academiaId, query.search),
      this.professores.searchPendingEmploymentByAcademia(
        query.academiaId,
        query.search,
      ),
    ]);

    const matchedEducatorIds = pendingRows
      .map((row) => row.educatorId)
      .filter((id): id is string => id !== null);

    const [studentCounts, matchedNames] = await Promise.all([
      this.professores.countClientsGroupedByProfessional(query.academiaId),
      this.professores.findNamesByIds(matchedEducatorIds),
    ]);

    return mergeProfessoresList({
      active: activeRows,
      pending: pendingRows.map((row) => ({
        id: row.id,
        educatorId: row.educatorId,
        matchedName: row.educatorId
          ? (matchedNames.get(row.educatorId) ?? null)
          : null,
        email: row.email,
      })),
      studentCounts,
      search: query.search,
      page: query.page,
      pageSize: PROFESSORES_PAGE_SIZE,
    });
  }
}
