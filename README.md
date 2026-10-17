<div align="center">
  <img src="https://github.com/vitaflow-team/vitaflow-frontend/raw/main/public/vitaflow.svg" alt="Vitaflow Logo" width="200" />
</div>

<h1 align="center">Vitaflow Backend</h1>

<p align="center">
  API REST do Vitaflow, construída com NestJS e Prisma — autenticação, perfis e planos,
  prontuário clínico, planos alimentares, treinos, agenda, academias e muito mais.
</p>

<p align="center">
  🇧🇷 Português | <a href="./README.en.md">🇺🇸 English</a>
</p>

<div align="center">

[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/nestjs-%23E0234E.svg?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)](https://www.prisma.io/)
[![Postgres](https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Jest](https://img.shields.io/badge/-jest-%23C21325.svg?style=for-the-badge&logo=jest&logoColor=white)](https://jestjs.io/)

</div>

## Sobre o projeto

O **Vitaflow** é uma plataforma que conecta **alunos/pacientes** a **profissionais de
saúde** — personal trainers (educadores físicos) e nutricionistas — além de suportar
**academias** que empregam educadores físicos e gerenciam seus próprios alunos.

Este repositório é a **API REST** que sustenta toda a plataforma (consumida pelo
[`vitaflow-frontend`](https://github.com/vitaflow-team/vitaflow-frontend)). Entre as
responsabilidades do backend estão:

- **Autenticação e contas**: cadastro, login (e-mail/senha e Google), ativação de
  conta, recuperação de senha, planos Gratuito/Premium por tipo de conta
  (Usuário, Nutricionista, Educador Físico, Academia).
- **Prontuário clínico genérico**: um motor de modelos de anamnese/avaliação
  customizáveis (`AssessmentTemplate`/`FormRecord`), compartilhado por
  nutricionistas, educadores físicos e academias — com cálculo automático de IMC.
- **Planos alimentares**: criação, versionamento, clonagem de dias e publicação de
  planos alimentares pela nutricionista, com histórico completo para o paciente.
- **Treinos**: prescrição de treinos pelo educador físico, geração assistida por IA
  (OpenAI) a partir da biblioteca de exercícios.
- **Diário alimentar**: registro livre de refeições com estimativa de calorias,
  meta diária e streak de uso.
- **Evolução e fotos**: acompanhamento de peso/medidas com gráficos e fotos de
  evolução privadas.
- **Agenda**: disponibilidade do profissional, agendamento de horários (presencial
  ou online) e horários fixos semanais, com lembretes automáticos (cron).
- **Academias (gyms)**: convites de emprego para educadores, catálogo de planos de
  acesso, check-in, turmas recorrentes e painel de engajamento.
- **Mensagens e notificações**: chat direto entre aluno e profissional, central de
  notificações com preferências por categoria e envio por e-mail.
- **Backoffice**: diretório de contas da equipe interna, sessões "ver como" (view
  as) auditadas, e trilha de auditoria.

## Tecnologias

- **[NestJS 11](https://nestjs.com/)** — framework Node.js progressivo, em TypeScript
- **[Prisma 6](https://www.prisma.io/)** — ORM, com **PostgreSQL** como banco de dados
- **[class-validator](https://github.com/typestack/class-validator) /
  [class-transformer](https://github.com/typestack/class-transformer)** — validação
  e transformação de DTOs
- **[Swagger / OpenAPI](https://docs.nestjs.com/openapi/introduction)** — documentação
  interativa da API (`@nestjs/swagger`)
- **[Jest](https://jestjs.io/)** — testes unitários e de integração (e2e)
- **[Nodemailer](https://nodemailer.com/) + Handlebars** — e-mails transacionais
  (ativação, recuperação de senha)
- **[Google Cloud Storage](https://cloud.google.com/storage)** — upload de avatares e
  fotos de evolução
- **[Stripe](https://stripe.com/)** — verificação (somente leitura) do status de
  assinatura, mesma conta usada pelo frontend
- **[OpenAI](https://platform.openai.com/)** — motor do Gerador de Treino por IA
- **[Helmet](https://helmetjs.github.io/)** — cabeçalhos de segurança HTTP
- **[@nestjs/throttler](https://docs.nestjs.com/security/rate-limiting)** — limitação
  de requisições
- **ESLint, Prettier, Husky, lint-staged, Commitlint** — padronização de código e
  commits (Conventional Commits)
- **Yarn** — gerenciador de pacotes

### Arquitetura em poucas palavras

- Organização por **domínio** dentro de `src/` (`auth`, `users`, `clients`,
  `clinical-records`, `meal-plans`, `nutritionist-patients`, `educator-students`,
  `academia`, `scheduling`, `workouts`, `exercise-library`, `progress`,
  `progress-photos`, `food-diary`, `messages`, `notifications`, `backoffice`,
  `professional-discovery`, `professional-mirror`, `professional-food-diary`,
  `product`, `mail`), não um balde genérico de "modules".
- **Padrão Repository** (`src/repositories`) desacopla a lógica de negócio (services)
  do Prisma.
- **Guards em camadas**: `AuthGuard` (sessão via JWT), `ApiKeyGuard` (segredo
  compartilhado, aplicado globalmente), e guards de papel/role
  (`ProfessionalGuard`, `NutritionistGuard`, `PhysicalEducatorGuard`,
  `AcademiaOwnerGuard`, `ReceptionistAuthGuard`, `PremiumGuard`, `AdminTierGuard`,
  `BackofficeGuard`, `GymStudentGuard`, `ViewAsWriteBlockGuard`).
- **Prontuário genérico**: em vez de campos fixos por tipo de profissional, o motor
  de `AssessmentTemplate`/`TemplateField`/`FormRecord`/`FormRecordValue` permite que
  cada profissional (ou a academia) crie seus próprios modelos de anamnese/avaliação.
- Mais de **50 modelos Prisma**, **155 arquivos de teste unitário** e **38 specs
  de integração (e2e)**.

## Instalação

### Pré-requisitos

- **Node.js** 20 ou superior (recomendado LTS)
- **Yarn**
- Uma instância **PostgreSQL** acessível (local, Docker, ou um serviço gerenciado)

### 1. Clonar e instalar dependências

```bash
cd vitaflow-backend
yarn install
```

O `postinstall` executa `prisma generate` automaticamente.

### 2. Configurar variáveis de ambiente

Copie `.env.example` para `.env` e preencha os valores:

```bash
cp .env.example .env
```

| Variável                                                                 | Obrigatória | Descrição                                                                                                 |
| ------------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                                                             | ✅          | Segredo para assinar tokens JWT — mínimo de 32 caracteres (gere com `openssl rand -base64 48`)            |
| `DATABASE_URL`                                                           | ✅          | String de conexão do PostgreSQL                                                                           |
| `APPLICATION_SECRET`                                                     | ✅          | Segredo compartilhado com o frontend (header `x-application-secret`, validado pelo `ApiKeyGuard`)         |
| `STRIPE_API_KEY`                                                         | ✅          | Chave secreta do Stripe (mesma conta do frontend) — usada apenas para verificar o status da assinatura    |
| `OPENAI_API_KEY`                                                         | ✅          | Chave da OpenAI — usada pelo Gerador de Treino por IA                                                     |
| `APP_URL`                                                                | ✅          | URL base do frontend — usada em links de e-mail e como origem CORS permitida                              |
| `GCP_PROJECT_ID` / `GCP_CLIENT_EMAIL` / `GCP_PRIVATE_KEY` / `GCP_BUCKET` | ✅          | Credenciais e bucket do Google Cloud Storage (avatares e fotos)                                           |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_USER` / `MAIL_PASS`                    | ✅          | Conta SMTP para e-mails transacionais                                                                     |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                              | opcional    | Login com Google — deixe ambas em branco para desativar; definir apenas uma impede o backend de iniciar   |
| `PORT`                                                                   | opcional    | Porta do servidor (padrão `3333`)                                                                         |
| `NODE_ENV`                                                               | opcional    | Em `production`, oculta o Swagger (`/swagger/api`) e confia em um hop de proxy                            |
| `CORS_ALLOWED_ORIGINS`                                                   | opcional    | Origens extras permitidas pelo CORS, separadas por vírgula                                                |
| `TRUST_PROXY_HOPS`                                                       | opcional    | Número de hops de proxy reverso à frente da aplicação (padrão: `1` em produção, `0` nos demais ambientes) |

> O backend valida as variáveis obrigatórias na inicialização e recusa subir,
> nomeando exatamente o que está faltando.

### 3. Banco de dados (Prisma)

```bash
# Aplicar/criar migrações em desenvolvimento
npx prisma migrate dev

# Regenerar o client do Prisma (já roda automaticamente no install)
npx prisma generate

# Popular dados iniciais (modelos padrão de anamnese/avaliação, etc.)
npx prisma db seed
```

### 4. Rodar em desenvolvimento

```bash
yarn start:dev
```

A API sobe em `http://localhost:3333` (ou na porta definida em `PORT`). A
documentação interativa (Swagger) fica disponível em `/swagger/api` (desabilitada
quando `NODE_ENV=production`).

Outros modos: `yarn start` (sem watch), `yarn start:debug` (watch + inspector).

## Build e produção

```bash
yarn build        # prisma generate && nest build
yarn start:prod   # node dist/main
```

## Testes e qualidade

```bash
yarn test          # testes unitários (Jest)
yarn test:watch    # modo watch
yarn test:cov       # relatório de cobertura
yarn test:e2e       # testes de integração — requer TEST_DATABASE_URL apontando
                     # para um banco isolado e migrado
yarn lint           # ESLint com --fix
yarn format         # Prettier
```

## Estrutura do projeto

```
src/
├── auth/                    # Login, guards de sessão, Google Sign-In
├── users/                   # Cadastro, perfil, assinatura
├── clients/                 # Vínculo profissional ↔ paciente/aluno
├── clinical-records/        # Motor genérico de anamnese/avaliação
├── meal-plans/               # Planos alimentares (nutricionista)
├── nutritionist-patients/    # Cadastro de pacientes pela nutricionista
├── educator-students/        # Alunos, treinos e agenda do educador físico
├── academia/                 # Academias: funcionários, planos, check-in, turmas
├── professional-discovery/   # Busca e conexão com profissionais
├── professional-mirror/      # Visão somente-leitura do paciente sobre seu profissional
├── professional-food-diary/  # Leitura do diário alimentar pelo profissional
├── scheduling/                # Disponibilidade, agendamento, horários fixos
├── workouts/                  # Treinos e Gerador de Treino por IA
├── exercise-library/           # Catálogo de exercícios
├── food-diary/                 # Diário alimentar do próprio usuário
├── progress/ , progress-photos/ # Evolução (medidas e fotos)
├── messages/ , notifications/   # Chat e central de notificações
├── backoffice/                  # Área administrativa interna
├── product/                     # Planos/produtos e grupos
├── mail/                        # Envio de e-mails
├── common/                      # Guards, decorators, filtros e erros compartilhados
├── config/                      # Configuração (env, Swagger, validação)
├── database/                    # Serviço do Prisma
├── repositories/                # Camada de acesso a dados
├── utils/                       # Utilitários
├── app.module.ts
└── main.ts
```

## Convenções

- Commits no padrão [Conventional Commits](https://www.conventionalcommits.org/),
  sempre em minúsculas no assunto (`feat: ...`, `fix: ...`), reforçado por
  `commitlint` via Husky.
- Branches de feature seguem `feature/<slug>`.
- O desenvolvimento é guiado por PRDs/TechSpecs mantidos fora do repositório, em
  `.compozy/tasks/<feature>/`.

---

<p align="center">
  Desenvolvido pela equipe Vitaflow
</p>
