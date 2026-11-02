---
name: vitaflow-backend-conventions
description: Apply vitaflow-backend's NestJS conventions (domain-per-folder structure, controller/DTO/service/repository/module roles, AppError, naming) whenever writing or reviewing backend code in vitaflow-backend. Builds on vitaflow-code-standards, which still applies.
---

# Vitaflow Backend Conventions

Rules specific to `vitaflow-backend` (NestJS + Prisma + PostgreSQL). They build on the language-agnostic rules in the `vitaflow-code-standards` skill (English-only code, function length, nesting, parameter count, one type per file), which still apply. For starting work on a new PRD (worktree, branch, registration), use the `vitaflow-git-workflow` skill.

## Procedure

1. Read `backend-code.md` in this repo's root in full before writing or reviewing backend code — it carries the complete rule set with examples and the marked **Refinement** notes (where the codebase's actual, consistent convention is stated explicitly), which this skill does not duplicate.
2. Apply its 8 rules:
   - One top-level folder per business domain under `src/`, holding its controller/service/module/DTOs/entities together; a domain with several use cases splits into one subfolder per use case. Exception: every repository lives under `src/repositories/<domain>/`, not colocated with its domain folder.
   - Controllers (`*.controller.ts`, class ends `Controller`) only orchestrate HTTP — one service-method call, no business logic, no self-validation. Every route is Swagger-documented (`@ApiTags`, `@ApiBearerAuth('jwt')` when authenticated, `@ApiOperation` + `@ApiResponse` per status). `@UseGuards(AuthGuard)` is applied once at the class level, never mixed per-method. The authenticated user id comes only from `req.user.id`, never a param/query/body.
   - DTOs (`*.Dto.ts`, capital D — the established project-wide convention) split request (`class` + `class-validator` decorators, named `Create<Thing>DTO`/`Update<Thing>DTO`/`<Thing>QueryDTO`) from response (`interface`, named `<Thing>ResponseDTO`, never decorated). A DTO shape also used as request input is still a validated `class`, regardless of what else reuses it for documentation.
   - Services (`*.service.ts`, class ends `Service`) hold business rules and orchestration; dependencies are `private readonly` constructor params; a service never imports `PrismaClient`/`PrismaService` directly — all persistence goes through an injected repository.
   - Repositories (`*.repository.ts`, under `src/repositories/<domain>/`) are the only layer that touches Prisma; no business rules, no HTTP concerns.
   - Modules (`*.module.ts`, class ends `Module`) declare every controller/provider a domain needs and import what they depend on (most commonly `AuthModule`); `exports` only when another module genuinely needs to inject a provider.
   - Every business-rule rejection throws `AppError` (`src/utils/app.erro.ts`), always from the service layer, with a status that matches what happened (401 auth/ownership, 404 not-found, 400 business-rule-the-DTO-couldn't-express, 500 only a genuine server precondition failure). The optional third `reason` argument is an internal English category code for logs — never sent to the client; the `message` is the user-facing string and may be in Portuguese per `code-standards.md` rule 1. `402` is reserved for an actual payment-required condition, never reused for "not found."
   - Naming: classes PascalCase, methods/variables camelCase, module-level constants UPPER_SNAKE_CASE, enum names PascalCase with UPPER_SNAKE_CASE values, filenames camelCase with the type suffix attached (`measurementRecords.repository.ts`), Prisma models PascalCase singular (standing exception: `Users`/`UsersToken`).
3. A deliberate exception is marked with `// code-standards: <rule> — <reason>` at the point of deviation, same mechanism as `vitaflow-code-standards`.

Done when the written/reviewed backend code follows every rule in `backend-code.md` (and `code-standards.md`), or every deviation carries its marker comment.
