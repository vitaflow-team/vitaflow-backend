import { ApiProperty } from '@nestjs/swagger';

const ROLES = ['USER', 'NUTRITIONIST', 'PHYSICAL_EDUCATOR', 'ACADEMIA'];

export class MrrDTO {
  @ApiProperty()
  current!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'null means Asaas was unreachable, never "comparison is 0"',
  })
  previousMonth!: number | null;

  @ApiProperty({ description: 'ISO timestamp of the cached/live Asaas read' })
  asOf!: string;
}

export class RegisteredByRoleDTO {
  @ApiProperty({ enum: ROLES })
  role!: 'USER' | 'NUTRITIONIST' | 'PHYSICAL_EDUCATOR' | 'ACADEMIA';

  @ApiProperty()
  free!: number;

  @ApiProperty()
  premium!: number;

  @ApiProperty()
  newThisMonth!: number;
}

export class ChurnByRoleDTO {
  @ApiProperty({ enum: ROLES })
  role!: 'USER' | 'NUTRITIONIST' | 'PHYSICAL_EDUCATOR' | 'ACADEMIA';

  @ApiProperty()
  canceledThisMonth!: number;
}

export class PlatformMetricsResponseDTO {
  @ApiProperty({ type: MrrDTO })
  mrr!: MrrDTO;

  @ApiProperty({ type: [RegisteredByRoleDTO] })
  registeredByRole!: RegisteredByRoleDTO[];

  @ApiProperty({ type: [ChurnByRoleDTO] })
  churnByRole!: ChurnByRoleDTO[];
}
