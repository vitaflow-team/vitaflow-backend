import { AcademiaStaffMemberRepository } from '@/repositories/academia/academiaStaffMember.repository';
import { UserRepository } from '@/repositories/users/user.repository';
import { Injectable } from '@nestjs/common';
import { ProductType } from '@prisma/client';
import {
  DirectoryListResult,
  DirectoryTypeFilter,
  mergeDirectoryResults,
} from './backofficeDirectoryMerge.util';

export const DIRECTORY_PAGE_SIZE = 50;

export interface DirectoryQuery {
  search?: string;
  type?: DirectoryTypeFilter;
  page: number;
}

@Injectable()
export class BackofficeDirectoryService {
  constructor(
    private readonly users: UserRepository,
    private readonly staffMembers: AcademiaStaffMemberRepository,
  ) {}

  async search(query: DirectoryQuery): Promise<DirectoryListResult> {
    const includeReceptionists =
      query.type === undefined || query.type === 'ACADEMIA';
    const userProductType =
      query.type === 'ACADEMIA'
        ? ProductType.ACADEMIA
        : (query.type as ProductType | undefined);

    const [userRows, receptionistRows] = await Promise.all([
      this.users.searchDirectory(query.search, userProductType),
      includeReceptionists
        ? this.staffMembers.searchAll(query.search)
        : Promise.resolve([]),
    ]);

    return mergeDirectoryResults({
      users: userRows.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        productType: (user.product?.type as DirectoryTypeFilter) ?? null,
      })),
      receptionists: receptionistRows.map((staff) => ({
        id: staff.id,
        name: staff.name,
        email: staff.email,
      })),
      page: query.page,
      pageSize: DIRECTORY_PAGE_SIZE,
    });
  }
}
