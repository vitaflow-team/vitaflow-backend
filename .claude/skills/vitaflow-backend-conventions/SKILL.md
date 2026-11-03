---
name: vitaflow-backend-conventions
description: Apply vitaflow-backend's NestJS conventions (domain-per-folder structure, controller/DTO/service/repository/module roles, AppError, naming) whenever writing or reviewing backend code in vitaflow-backend. Builds on vitaflow-code-standards, which still applies.
---

# Vitaflow Backend Conventions

Rules specific to `vitaflow-backend` (NestJS + Prisma + PostgreSQL), building on `vitaflow-code-standards` (English-only code, function length, nesting, parameter count, one type per file), which still applies. For starting a new PRD (worktree, branch, registration), use `vitaflow-git-workflow`.

New code follows this document; existing code is brought in line opportunistically, not through mass rewrites.

## 1. Domain-per-folder

One top-level folder per business domain under `src/`; colocate everything that belongs to it (controller, service, module, DTOs) — never a generic `controllers/`/`services/`/`dtos/` folder grouped by file type. A domain with several use cases (sign up, sign in, profile) splits into one subfolder per use case, each a self-contained controller/service/DTO trio, wired by a single `<domain>.module.ts` at the domain root.

DTOs for a domain or use case live under its own `dto/` subfolder (`src/billing/invoices/dto/createInvoice.Dto.ts`) — the default for every newer domain. A few older use cases still keep DTOs flat next to the controller; leave those as-is rather than migrating them.

**Exception**: every repository lives under `src/repositories/<domain>/`, never inside the domain folder — keeps Prisma-specific code out of the domain and lets repositories be reused across domains without a circular import.

## 2. Controllers — `*.controller.ts`, class `*Controller`

Orchestrates HTTP only: no validation (the DTO's job), no business logic (the service's job) — parse the request, call exactly one service method, return the result. `@UseGuards(AuthGuard)` goes on the class, never per method (split into two controllers if one needs both authenticated and public routes). Every route is Swagger-documented: `@ApiTags` and, when authenticated, `@ApiBearerAuth('jwt')` at the class level; `@ApiOperation` plus one `@ApiResponse` per meaningful status code per method; `@ApiQuery` for each query parameter. A route with a body takes a request DTO; a route with a meaningful response documents it with a response DTO (a `204` delete is exempt).

**Read the authenticated user only from `req.user.id`** on an `AuthenticatedRequest` — never from a route param, query string, or body. A client must never be able to name a different user's id and have the controller act on it.

## 3. DTOs — `*.Dto.ts` (capital D), validated with `class-validator`

Established project-wide convention with zero lowercase `.dto.ts` exceptions — keep it for new files. Request DTOs are decorated `class`es validated by the global `ValidationPipe({ transform: true })`, named for the action they validate (`Create<Thing>DTO`, `Update<Thing>DTO`, `<Thing>QueryDTO`); a family that only adds optional fields may extend the base class. Response DTOs are plain `interface`s (`<Thing>ResponseDTO`) — never decorated, never re-validated. Use `class-transformer` (`@Type(() => Date)`, `@Transform`) inside a request DTO to coerce raw HTTP input (always strings, sometimes arrays) before validation runs.

A DTO shaped for a Swagger response that is also accepted back as input must still be a validated `class` — it's a request DTO the moment any decorated field can arrive from the client, regardless of what else reuses its shape for documentation.

## 4. Services — `*.service.ts`, class `*Service`, DI only

Holds business rules: state-dependent validation (not input shape — that's the DTO's job), orchestration across repositories, calls to other services/utilities. Never imports `PrismaClient`/`PrismaService` or builds a query directly — always through an injected repository (§5). Constructor-inject every dependency as `private readonly`. Throws `AppError` to reject a request (§7), never `HttpException` or a plain `Error`.

## 5. Repositories — `*.repository.ts`, the only Prisma layer

Lives under `src/repositories/<domain>/` (§1 exception); translates a domain-shaped call into a Prisma query and back — no business rules, no HTTP concerns. Only repositories inject `PrismaService`; a service depends on repositories, never on `PrismaService` directly — keeps every Prisma detail (field names, `include`, `orderBy`) in one place per model and keeps services trivially mockable in tests.

## 6. Modules — `*.module.ts`, one per domain

Declares the domain's controllers and providers (services, repositories); `imports` any module whose exported providers it needs (most commonly `AuthModule`, for `AuthGuard`). Adds an `exports` array only when another module genuinely needs to inject one of its providers — most domain modules export nothing. `AuthModule` is the standing exception, exporting `JwtModule`, `AuthGuard`, and its other shared providers.

## 7. Errors — `AppError` or `CodedError`, always from a service

Every business-rule rejection throws one of two `HttpException` subclasses, thrown inside a **service** method — never a controller or repository, and never a plain `Error`.

- **`AppError`** (`src/utils/app.erro.ts`) is the default. Pick the status for what actually happened: `401` auth/ownership failures, `404` "no such resource" (including the user's own profile — never reuse `402` for "not found"), `400` a request that fails a business rule the DTO couldn't express, `500` only for a genuine server-side precondition failure. Its optional third argument (`reason`) is an internal English category code for logs/audits, never sent to the client — distinct from `message`, the user-facing string (which may be Portuguese per `vitaflow-code-standards` rule 1).
- **`CodedError`** (`src/common/errors/codedError.ts`) is for the one case `AppError` can't cover: the client needs a stable, machine-readable `code` in the response body to tell apart two failures sharing the same status (`AppError.reason` can't do this — it is never sent). Equally established as `AppError` (used about as often project-wide) — reach for it whenever the frontend must branch on _which_ failure happened, not just the status. Takes an optional `details` payload (structured data for the client, never user content).

```ts
throw new CodedError('Treino indisponível no momento.', 502, 'llm_call_failed');
```

## 8. Naming

- **Classes** (controllers, services, DTOs, modules, guards, repositories, entities, Prisma models): PascalCase.
- **Methods/variables**: camelCase. **Module-level constants** (fixed at load time): UPPER_SNAKE_CASE.
- **Enum names** PascalCase; **enum values** UPPER_SNAKE_CASE (matches `schema.prisma`).
- **Filenames**: camelCase with the type suffix attached (`measurementRecords.repository.ts`) — no kebab-case for new files.
- **Prisma models**: PascalCase singular. `Users` (and `UsersToken`) is the one standing plural exception, kept for compatibility — never repeat it for a new model.

## Enforcement

Follow this skill together with `vitaflow-code-standards`. Both are reviewed in code review; a deliberate exception is marked `// code-standards: <rule> — <reason>` at the point of deviation.
