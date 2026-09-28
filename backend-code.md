# Backend Code Standards

Rules specific to `vitaflow-backend` (NestJS + Prisma + PostgreSQL). These build on the language-agnostic rules in [`../code-standards.md`](../code-standards.md) — that document still applies (English-only code, function length, nesting, parameter count, one type per file). This document adds NestJS-specific structure and naming. For starting work on a new PRD (worktree, branch, registration), see [`../git-workflow.md`](../git-workflow.md).

The rules below reflect the project's actual, consistent conventions, refined in the few places the codebase itself is inconsistent (noted inline as **Refinement**). New code follows this document; existing code may be brought in line opportunistically, not as a required mass rename.

---

## 1. Organize by domain, one folder per feature

Each business domain lives in its own top-level folder under `src/`, and every file that belongs to it — controller, service, module, DTOs, entities — is colocated in that folder (or in a subfolder for a specific use case within the domain). Do not spread one feature's controller, service, and DTOs across unrelated directories, and do not create a generic `controllers/`, `services/`, or `dtos/` folder that groups by file type instead of by feature.

A domain with several distinct use cases (sign up, sign in, profile, password recovery) splits into **one subfolder per use case**, each a self-contained controller/service/DTO trio, wired together by a single `<domain>.module.ts` at the domain root.

```
src/
  progress/                        # simple domain, no subfeatures
    progress.controller.ts
    progress.service.ts
    progress.module.ts
    progress.Dto.ts
    progress.controller.spec.ts
    progress.service.spec.ts

  users/                           # domain with several use cases
    users.module.ts                # wires every subfeature's controller/service
    profile/
      profile.controller.ts
      profile.service.ts
      profile.Dto.ts
    signup/
      signup.controller.ts
      signup.service.ts
      signup.Dto.ts
    signin/
      signin.controller.ts
      signin.service.ts
      signin.Dto.ts
```

**Exception**: data-access code is not colocated with its domain folder. Every repository lives under `src/repositories/<domain>/`, so the domain folder stays free of Prisma-specific code and repositories can be reused across domains without a circular import (e.g. `SubscriptionService`, in `users/subscription/`, using `src/repositories/product/product.repository.ts`).

---

## 2. Controllers: `*.controller.ts`, Swagger-documented, one request DTO and one response DTO

Every controller file ends in `.controller.ts` and its class name ends in `Controller` (`ProgressController`, `SignUpController`). A controller only orchestrates HTTP: it validates nothing itself (that is the DTO's job via the global `ValidationPipe`) and contains no business logic (that is the service's job) — it parses the request, calls exactly one service method, and returns the result.

Every route is documented with Swagger decorators: `@ApiTags` at the class level, `@ApiBearerAuth('jwt')` at the class level when the route requires authentication, and `@ApiOperation` plus one `@ApiResponse` per meaningful status code on every method. A route that takes a query object adds `@ApiQuery` for each query parameter.

Every route that accepts a body takes a request DTO (a validated `class`, never an inline object shape) and every route documents its response shape with a response DTO. A route family (`create`/`update`) may reuse one request DTO through inheritance (see §3); a route with no meaningful response body (e.g. a `204 No Content` delete) is exempt from a response DTO.

```ts
// src/progress/progress.controller.ts
@ApiTags('Progress records')
@ApiBearerAuth('jwt')
@Controller('progress-records')
@UseGuards(AuthGuard)
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @ApiOperation({
    summary: 'Create a new measurement record for the authenticated user',
  })
  @ApiResponse({
    status: 201,
    description: 'Record created.',
    type: MeasurementRecordResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'Invalid measurement values.' })
  @ApiResponse({ status: 401, description: 'Unauthorized access.' })
  @Post()
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() body: CreateMeasurementRecordDTO,
  ): Promise<MeasurementRecordResponseDTO> {
    return this.progressService.create(req.user.id, body);
  }
}
```

**Authentication is guarded at the class level.** Apply `@UseGuards(AuthGuard)` once, on the controller class, not per method — a controller is either fully authenticated or fully public; mixing the two in one controller is a sign it should be split into two controllers.

**Refinement**: read the authenticated user id only from `req.user.id` inside an `AuthenticatedRequest`-typed request, never from a route param, query string, or request body — a client must never be able to name a different user's id and have the controller act on it.

---

## 3. DTOs: `*.Dto.ts`, validated with `class-validator`, one request class and one response type

Every DTO file ends in `.Dto.ts` — note the capital `D`. This is the project's established, project-wide convention; keep it for new files instead of introducing a mixed-case codebase.

> **Refinement note**: NestJS's own generators default to a lowercase `.dto.ts` suffix, and a new project should typically follow that default. `vitaflow-backend` has already standardized on `.Dto.ts` across every domain (`profile.Dto.ts`, `signup.Dto.ts`, `progress.Dto.ts`, and every other DTO file), with zero lowercase exceptions. Matching that existing, consistent convention beats a partial migration that leaves the codebase with two suffixes — so `.Dto.ts` is the rule here.

A DTO file separates two shapes:

- **Request DTOs** are `class` declarations decorated with `class-validator` decorators, so the global `ValidationPipe({ transform: true })` validates and coerces them automatically. Name them for the action they validate: `Create<Thing>DTO`, `Update<Thing>DTO`, `<Thing>QueryDTO`.
- **Response DTOs** are plain `interface` declarations — no decorators, because a response is never re-validated at runtime. Name them `<Thing>ResponseDTO`.

```ts
// src/progress/progress.Dto.ts
export class CreateMeasurementRecordDTO {
  @ApiProperty({ example: 70.5, minimum: 20, maximum: 300 })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(20)
  @Max(300)
  weightKg: number;

  @ApiPropertyOptional({ example: 78 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  waistCm?: number;
}

// A route family that only adds optional fields reuses the base DTO by extension.
export class UpdateMeasurementRecordDTO extends CreateMeasurementRecordDTO {}

// Response shape: an interface, never validated, only typed.
export interface MeasurementRecordResponseDTO {
  id: string;
  weightKg: number;
  bmi: number;
  bmiClassification: BmiClassification;
}
```

Use `class-transformer` decorators inside request DTOs whenever raw HTTP input (always strings, sometimes arrays) needs coercing before validation runs: `@Type(() => Date)` for a date field, `@Transform(...)` for a query string that must become a number or be normalized before `@IsIn`/`@IsOptional` inspects it.

```ts
export const DASHBOARD_WEEKS = [4, 8, 12] as const;

export class DashboardQueryDTO {
  @ApiPropertyOptional({ enum: DASHBOARD_WEEKS })
  @IsOptional()
  @Transform(({ value }: TransformFnParams) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsIn(DASHBOARD_WEEKS as unknown as number[])
  weeks?: (typeof DASHBOARD_WEEKS)[number];
}
```

**Refinement**: a DTO used only to shape a Swagger response and also accepted back as input (as `ProfileDTO` is) should still be a validated `class` — a DTO is a request DTO the moment any decorated field of it can arrive from the client, regardless of what else reuses its shape for documentation.

---

## 4. Services: `*.service.ts`, dependency injection only, no direct Prisma access

Every service file ends in `.service.ts` and its class name ends in `Service`. A service holds business rules: validation that depends on domain state (not just input shape — that stays in the DTO), orchestration across repositories, and calls to other services or utilities (`UploadService`, `MailService`, `PasswordHash`). A service never imports `PrismaClient`/`PrismaService` directly and never builds a Prisma query itself — all persistence goes through an injected repository (§5).

Dependencies are declared as constructor parameters with a visibility modifier, so Nest's dependency injection assigns them automatically. Use `private readonly` for every injected dependency — `readonly` documents that the reference is never reassigned after construction.

```ts
// src/progress/progress.service.ts
@Injectable()
export class ProgressService {
  constructor(
    private readonly measurementRecords: MeasurementRecordsRepository,
  ) {}

  async create(
    userId: string,
    dto: CreateMeasurementRecordDTO,
  ): Promise<MeasurementRecordResponseDTO> {
    const record = await this.measurementRecords.create(
      userId,
      toMeasurementInput(dto),
    );
    return toMeasurementResponse(record);
  }
}
```

```ts
// src/users/profile/profile.service.ts
@Injectable()
export class ProfileService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly uploadService: UploadService,
    private readonly clientsRepository: ClientsRepository,
  ) {}
}
```

A service method that needs to reject a request throws `AppError` (`src/utils/app.erro.ts`), never a raw `HttpException` subtype and never a plain `Error` — see §7.

**Refinement**: some services in the current codebase inject with plain `private` (no `readonly`). Keep `readonly` for every new or touched constructor; it costs nothing and prevents a dependency from being reassigned by mistake.

---

## 5. Repositories: `*.repository.ts`, the only layer that touches Prisma

Every repository file ends in `.repository.ts` and lives under `src/repositories/<domain>/`, separate from the domain's controller/service folder (§1). A repository's only job is translating a domain-shaped call into a Prisma query and back; it holds no business rules and no HTTP concerns.

```ts
// src/repositories/progress/measurementRecords.repository.ts
@Injectable()
export class MeasurementRecordsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<MeasurementRecord | null> {
    return this.prisma.measurementRecord.findUnique({ where: { id } });
  }
}
```

Only repositories inject `PrismaService`. A service depends on one or more repositories, never on `PrismaService` — this keeps every Prisma-specific detail (field names, `include`, `orderBy`) in one place per model and makes services trivial to unit-test with a plain mock (§8).

---

## 6. Modules: `*.module.ts`, one module per domain

Every module file ends in `.module.ts` and its class name ends in `Module`. A domain module declares every controller and provider (services, repositories) that domain needs, and `imports` any other module whose exported providers it depends on (most commonly `AuthModule`, for `AuthGuard`).

```ts
// src/progress/progress.module.ts
@Module({
  imports: [AuthModule],
  controllers: [ProgressController],
  providers: [PrismaService, MeasurementRecordsRepository, ProgressService],
})
export class ProgressModule {}
```

A module only adds an `exports` array when another module genuinely needs to inject one of its providers — most domain modules export nothing. `AuthModule` is the standing exception, exporting `JwtModule`, `AuthGuard`, and its other shared providers for every other domain to import.

---

## 7. Errors: always `AppError`, always thrown from the service layer

Every business-rule rejection throws `AppError` (`src/utils/app.erro.ts`, an `HttpException` subclass), and it is always thrown inside a **service** method, never inside a controller or a repository. A controller that needs to reject a request before calling its service (this should be rare — that validation belongs in the DTO) still delegates the throw to the service.

```ts
// src/progress/progress.service.ts
async assertOwnership(recordId: string, userId: string): Promise<void> {
  const record = await this.measurementRecords.findById(recordId);
  if (!record) {
    throw new AppError('Registro não encontrado.', 404);
  }
  if (record.userId !== userId) {
    throw new AppError('Ação não permitida.', 401);
  }
}
```

Pick the status code for what actually happened: `401` for authentication or ownership failures, `404` for "no such resource," `400` for a request that fails a business rule the DTO could not express, `500` only for a genuine server-side precondition failure (e.g. required seed data missing). The optional third `AppError` constructor argument (`reason`) is an internal, English-language category code for logs and audits (e.g. `'linked_user_not_found'`) — it is never sent to the client and is a different thing from the `message`, which is the user-facing string shown by the API.

**Refinement**: `402 Payment Required` has appeared in this codebase standing in for "not found." Do not reuse `402` for anything other than an actual payment-required condition — use `404` for "resource not found," even when the resource in question is the user's own profile.

Per [`code-standards.md`](../code-standards.md) rule 1, the `message` shown to the end user may be in Portuguese (it is product copy); the `reason` code, like every other identifier, is in English.

---

## 8. Naming conventions

- **Classes** (controllers, services, DTOs, modules, guards, repositories, entities, Prisma models) are **PascalCase**: `ProfileService`, `CreateMeasurementRecordDTO`, `AuthGuard`, `MeasurementRecordsRepository`.
- **Methods and variables** are **camelCase**: `getDashboard`, `assertOwnership`, `weightVariationKg`.
- **Module-level constants** (values fixed at load time, never reassigned) are **UPPER_SNAKE_CASE**: `DASHBOARD_WEEKS`, `DEFAULT_DASHBOARD_WEEKS`.
- **Enum names** are PascalCase; **enum values** are UPPER_SNAKE_CASE, matching the Prisma convention already in `schema.prisma` (`enum ProductType { USER NUTRITIONIST PHYSICAL_EDUCATOR }`).
- **Filenames** are camelCase for multi-word names, with the type suffix always attached: `measurementRecords.repository.ts`, `userToken.repository.ts`, `profileAddress.Dto.ts`. Do not mix in kebab-case (`some-name.service.ts`) for new files — camelCase is the project's dominant convention and the one to converge on.
- **Prisma models** are PascalCase and singular (`MeasurementRecord`, `Client`, `Product`). The one standing exception is `Users` (and `UsersToken`, which inherits its plural): do not introduce further plural model names — `Users` stays as-is for compatibility, but every new model is singular.

---

## Enforcement

Follow this document together with [`../code-standards.md`](../code-standards.md). Both are reviewed in code review; a deliberate exception is marked inline with `// code-standards: <rule> — <reason>` at the point of deviation, exactly as described there.
