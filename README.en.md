<div align="center">
  <img src="https://github.com/vitaflow-team/vitaflow-frontend/raw/main/public/vitaflow.svg" alt="Vitaflow Logo" width="200" />
</div>

<h1 align="center">Vitaflow Backend</h1>

<p align="center">
  Vitaflow's REST API, built with NestJS and Prisma — authentication, profiles and
  plans, clinical records, meal plans, workouts, scheduling, gyms and more.
</p>

<p align="center">
  <a href="./README.md">🇧🇷 Português</a> | 🇺🇸 English
</p>

<div align="center">

[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/nestjs-%23E0234E.svg?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)](https://www.prisma.io/)
[![Postgres](https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Jest](https://img.shields.io/badge/-jest-%23C21325.svg?style=for-the-badge&logo=jest&logoColor=white)](https://jestjs.io/)

</div>

## About the project

**Vitaflow** is a platform that connects **students/patients** with **health
professionals** — personal trainers (physical educators) and nutritionists — and
also supports **gyms (academias)** that employ physical educators and manage their
own students.

This repository is the **REST API** that powers the whole platform (consumed by
[`vitaflow-frontend`](https://github.com/vitaflow-team/vitaflow-frontend)). Backend
responsibilities include:

- **Authentication and accounts**: sign-up, sign-in (e-mail/password and Google),
  account activation, password recovery, Free/Premium plans per account type
  (User, Nutritionist, Physical Educator, Academia).
- **Generic clinical records**: a customizable anamnese/assessment template engine
  (`AssessmentTemplate`/`FormRecord`), shared across nutritionists, physical
  educators and academias — with automatic BMI calculation.
- **Meal plans**: creation, versioning, day cloning and publishing of meal plans by
  the nutritionist, with a full history for the patient.
- **Workouts**: workout prescription by the physical educator, AI-assisted
  generation (OpenAI) from the exercise library.
- **Food diary**: free-text meal logging with calorie estimates, a daily goal, and
  a usage streak.
- **Progress and photos**: weight/measurement tracking with charts and private
  progress photos.
- **Scheduling**: professional availability, slot booking (in-person or online),
  and recurring weekly fixed times, with automated cron-based reminders.
- **Gyms (academias)**: employment invitations for educators, an access-plan
  catalog, check-in, recurring classes ("turmas") and an engagement dashboard.
- **Messages and notifications**: direct chat between a student and their
  professional, a notification center with per-category preferences and e-mail
  delivery.
- **Backoffice**: an internal-staff account directory, audited "view as" sessions,
  and an audit log.

## Technologies

- **[NestJS 11](https://nestjs.com/)** — progressive Node.js framework, in
  TypeScript
- **[Prisma 6](https://www.prisma.io/)** — ORM, with **PostgreSQL** as the database
- **[class-validator](https://github.com/typestack/class-validator) /
  [class-transformer](https://github.com/typestack/class-transformer)** — DTO
  validation and transformation
- **[Swagger / OpenAPI](https://docs.nestjs.com/openapi/introduction)** —
  interactive API documentation (`@nestjs/swagger`)
- **[Jest](https://jestjs.io/)** — unit and integration (e2e) testing
- **[Nodemailer](https://nodemailer.com/) + Handlebars** — transactional e-mails
  (activation, password recovery)
- **[Google Cloud Storage](https://cloud.google.com/storage)** — avatar and
  progress-photo uploads
- **[Stripe](https://stripe.com/)** — read-only subscription status verification,
  same account used by the frontend
- **[OpenAI](https://platform.openai.com/)** — powers the AI Workout Generator
- **[Helmet](https://helmetjs.github.io/)** — HTTP security headers
- **[@nestjs/throttler](https://docs.nestjs.com/security/rate-limiting)** — rate
  limiting
- **ESLint, Prettier, Husky, lint-staged, Commitlint** — code and commit
  standardization (Conventional Commits)
- **Yarn** — package manager

### Architecture at a glance

- **Domain-per-folder** layout under `src/` (`auth`, `users`, `clients`,
  `clinical-records`, `meal-plans`, `nutritionist-patients`, `educator-students`,
  `academia`, `scheduling`, `workouts`, `exercise-library`, `progress`,
  `progress-photos`, `food-diary`, `messages`, `notifications`, `backoffice`,
  `professional-discovery`, `professional-mirror`, `professional-food-diary`,
  `product`, `mail`) — not a generic "modules" bucket.
- **Repository pattern** (`src/repositories`) decouples business logic (services)
  from Prisma.
- **Layered guards**: `AuthGuard` (JWT session), `ApiKeyGuard` (shared secret,
  applied globally), and role guards (`ProfessionalGuard`, `NutritionistGuard`,
  `PhysicalEducatorGuard`, `AcademiaOwnerGuard`, `ReceptionistAuthGuard`,
  `PremiumGuard`, `AdminTierGuard`, `BackofficeGuard`, `GymStudentGuard`,
  `ViewAsWriteBlockGuard`).
- **Generic clinical-records engine**: instead of hardcoded fields per professional
  type, the `AssessmentTemplate`/`TemplateField`/`FormRecord`/`FormRecordValue`
  engine lets each professional (or the academia) define their own
  anamnese/assessment templates.
- **50+ Prisma models**, **155 unit test files** and **38 integration (e2e)
  specs**.

## Installation

### Prerequisites

- **Node.js** 20 or higher (LTS recommended)
- **Yarn**
- A reachable **PostgreSQL** instance (local, Docker, or a managed service)

### 1. Clone and install dependencies

```bash
cd vitaflow-backend
yarn install
```

`postinstall` runs `prisma generate` automatically.

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable                                                                 | Required | Description                                                                                       |
| ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                                                             | ✅       | Secret used to sign JWT tokens — at least 32 characters (generate with `openssl rand -base64 48`) |
| `DATABASE_URL`                                                           | ✅       | PostgreSQL connection string                                                                      |
| `APPLICATION_SECRET`                                                     | ✅       | Secret shared with the frontend (`x-application-secret` header, checked by `ApiKeyGuard`)         |
| `STRIPE_API_KEY`                                                         | ✅       | Stripe secret key (same account as the frontend) — used only to verify subscription status        |
| `OPENAI_API_KEY`                                                         | ✅       | OpenAI key — used by the AI Workout Generator                                                     |
| `APP_URL`                                                                | ✅       | Frontend base URL — used in e-mail links and as the allowed CORS origin                           |
| `GCP_PROJECT_ID` / `GCP_CLIENT_EMAIL` / `GCP_PRIVATE_KEY` / `GCP_BUCKET` | ✅       | Google Cloud Storage credentials and bucket (avatars and photos)                                  |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_USER` / `MAIL_PASS`                    | ✅       | SMTP account for transactional e-mails                                                            |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                              | optional | Google sign-in — leave both blank to disable; setting only one prevents the backend from starting |
| `PORT`                                                                   | optional | Server port (defaults to `3333`)                                                                  |
| `NODE_ENV`                                                               | optional | In `production`, hides Swagger (`/swagger/api`) and trusts one proxy hop                          |
| `CORS_ALLOWED_ORIGINS`                                                   | optional | Extra CORS-allowed origins, comma-separated                                                       |
| `TRUST_PROXY_HOPS`                                                       | optional | Reverse-proxy hops in front of the app (defaults to `1` in production, `0` elsewhere)             |

> The backend validates every required variable at startup and refuses to boot,
> naming exactly what's missing.

### 3. Database (Prisma)

```bash
# Apply/create migrations in development
npx prisma migrate dev

# Regenerate the Prisma client (already runs automatically on install)
npx prisma generate

# Seed starter data (default anamnese/assessment templates, etc.)
npx prisma db seed
```

### 4. Run in development

```bash
yarn start:dev
```

The API serves at `http://localhost:3333` (or the port set in `PORT`). Interactive
documentation (Swagger) is available at `/swagger/api` (disabled when
`NODE_ENV=production`).

Other run modes: `yarn start` (no watch), `yarn start:debug` (watch + inspector).

## Build & production

```bash
yarn build        # prisma generate && nest build
yarn start:prod   # node dist/main
```

## Testing & quality

```bash
yarn test          # unit tests (Jest)
yarn test:watch    # watch mode
yarn test:cov       # coverage report
yarn test:e2e       # integration tests — requires TEST_DATABASE_URL pointing at an
                     # isolated, migrated database
yarn lint           # ESLint with --fix
yarn format         # Prettier
```

## Project structure

```
src/
├── auth/                    # Sign-in, session guards, Google Sign-In
├── users/                   # Sign-up, profile, subscription
├── clients/                 # Professional ↔ patient/student relationship
├── clinical-records/        # Generic anamnese/assessment engine
├── meal-plans/               # Meal plans (nutritionist)
├── nutritionist-patients/    # Patient registration by the nutritionist
├── educator-students/        # The physical educator's students, workouts, schedule
├── academia/                 # Gyms: staff, access plans, check-in, classes
├── professional-discovery/   # Search and connect with professionals
├── professional-mirror/      # The patient's read-only view of their professional
├── professional-food-diary/  # Professional's read access to the food diary
├── scheduling/                # Availability, booking, fixed times
├── workouts/                  # Workouts and the AI Workout Generator
├── exercise-library/           # Exercise catalog
├── food-diary/                 # The user's own food diary
├── progress/ , progress-photos/ # Progress tracking (measurements and photos)
├── messages/ , notifications/   # Chat and notification center
├── backoffice/                  # Internal admin area
├── product/                     # Plans/products and groups
├── mail/                        # E-mail delivery
├── common/                      # Shared guards, decorators, filters and errors
├── config/                      # Configuration (env, Swagger, validation)
├── database/                    # Prisma service
├── repositories/                # Data access layer
├── utils/                       # Utilities
├── app.module.ts
└── main.ts
```

## Conventions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/),
  always lower-case in the subject (`feat: ...`, `fix: ...`), enforced by
  `commitlint` via Husky.
- Feature branches follow `feature/<slug>`.
- Development is driven by PRDs/TechSpecs kept outside this repository, under
  `.compozy/tasks/<feature>/`.

---

<p align="center">
  Built by the Vitaflow team
</p>
