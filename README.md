<div align="center">
  <img src="https://github.com/vitaflow-team/vitaflow-frontend/raw/main/public/logo.png" alt="Vitaflow Logo" width="200" />
</div>

<h1 align="center">Vitaflow Backend</h1>

<p align="center">
  API robusta e escalável para a plataforma Vitaflow, construída com NestJS e Prisma.
  Gerencia autenticação, usuários, planos de treino, dietas e comunicação entre nutricionistas, personal trainers e alunos.
</p>

<div align="center">

[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/nestjs-%23E0234E.svg?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)](https://www.prisma.io/)
[![Postgres](https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Jest](https://img.shields.io/badge/-jest-%23C21325?style=for-the-badge&logo=jest&logoColor=white)](https://jestjs.io/)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

</div>

## 🚀 Tecnologias

Este projeto foi desenvolvido utilizando as seguintes tecnologias:

- **[NestJS](https://nestjs.com/)**: Framework Node.js progressivo para construir aplicações do lado do servidor eficientes e escaláveis.
- **[Prisma](https://www.prisma.io/)**: ORM moderno para Node.js e TypeScript.
- **[TypeScript](https://www.typescriptlang.org/)**: Superset tipado de JavaScript.
- **[PostgreSQL](https://www.postgresql.org/)**: Banco de dados relacional robusto.
- **[Jest](https://jestjs.io/)**: Framework de testes focado em simplicidade.
- **[Node Mailer](https://nodemailer.com/)**: Para envio de emails transacionais.
- **[Google Cloud Storage](https://cloud.google.com/storage)**: Para gerenciar uploads de arquivos.

## 🛡️ Segurança

A segurança é uma prioridade no backend da Vitaflow. Implementamos:

- **Autenticação JWT**: Proteção robusta de rotas utilizando JSON Web Tokens.
- **Guards Personalizados**: `ApiKeyGuard` para serviços internos e `AuthGuard` para validação de sessão.
- **Hashing de Senha**: Utilização de Bcrypt para armazenamento seguro de credenciais.
- **Validação de Dados**: Pipes de validação global com `class-validator` para garantir a integridade dos dados recebidos.

## 🛠️ Instalação e Configuração

Siga os passos abaixo para rodar o projeto localmente.

### 1. Pré-requisitos

Certifique-se de ter instalado:

- **Node.js** (v18 ou superior)
- **NPM** ou **Yarn**
- **PostgreSQL** (Rodando localmente ou via Docker)

### 2. Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto e configure as seguintes variáveis (baseado no `.env.example` se disponível):

```env
# Banco de Dados
DATABASE_URL="postgresql://user:password@localhost:5432/vitaflow_db?schema=public"

# Autenticação
JWT_SECRET="seu-segredo-jwt-seguro"
APPLICATION_SECRET="segredo-para-api-key-guard"

# Configurações de Porta (Opcional)
PORT=3333

# Outros serviços (Exemplos)
MAIL_HOST=smtp.example.com
MAIL_USER=user@example.com
MAIL_PASS=password
```

### 3. Rodando o Projeto

Instale as dependências:

```bash
npm install
```

Gere os artefatos do Prisma:

```bash
npx prisma generate
```

(Opcional) Rode as migrations para criar as tabelas no banco:

```bash
npx prisma migrate dev
```

Inicie o servidor de desenvolvimento:

```bash
npm run start:dev
```

O servidor estará rodando em `http://localhost:3333` (ou na porta definida no `.env`).

## 📂 Estrutura do Projeto

A estrutura de pastas segue os padrões modulares do NestJS:

```
src/
├── auth/           # Guards e lógica de autorização
├── common/         # Decorators, filters e interceptors globais
├── config/         # Configurações de ambiente
├── database/       # Configuração do Prisma
├── modules/        # Módulos de funcionalidade (Users, Clients, Products)
├── repositories/   # Camada de acesso a dados
├── utils/          # Funções utilitárias e helpers
├── app.module.ts   # Módulo raiz da aplicação
└── main.ts         # Ponto de entrada da aplicação
```

## 📝 Scripts Disponíveis

- `npm run start`: Inicia a aplicação em produção.
- `npm run start:dev`: Inicia a aplicação em modo de desenvolvimento (watch).
- `npm run build`: Compila o projeto para a pasta `dist`.
- `npm run test`: Executa os testes unitários via Jest.
- `npm run test:cov`: Gera relatório de cobertura de testes.
- `npm run lint`: Executa o ESLint para verificar e corrigir problemas de código.
- `npm run format`: Formata o código usando Prettier.

## 🤝 Contribuição

As contribuições são bem-vindas! Sinta-se à vontade para abrir issues ou enviar pull requests.

1. Faça um Fork do projeto
2. Crie uma Branch para sua Feature (`git checkout -b feature/MinhaFeature`)
3. Faça o Commit de suas mudanças (`git commit -m 'Adiciona MinhaFeature'`)
4. Faça o Push para a Branch (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request

---

<p align="center">
  Desenvolvido com ❤️ pela equipe Vitaflow
</p>
