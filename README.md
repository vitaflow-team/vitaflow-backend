<div align="center">
  <img src="https://github.com/vitaflow-team/vitaflow-frontend/raw/main/public/logo.png" alt="Vitaflow Logo" width="200" />
</div>

<h1 align="center">Vitaflow Backend</h1>

<p align="center">
  Robust and scalable API for the Vitaflow platform, built with NestJS and Prisma.
  Manages authentication, users, workout plans, diets, and communication between nutritionists, personal trainers, and students.
</p>

<div align="center">

[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/nestjs-%23E0234E.svg?style=for-the-badge&logo=nestjs&logoColor=white)](https://nestjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)](https://www.prisma.io/)
[![Postgres](https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Jest](https://img.shields.io/badge/-jest-%23C21325.svg?style=for-the-badge&logo=jest&logoColor=white)](https://jestjs.io/)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

</div>

## 🚀 Technologies

This project was developed using the following technologies:

- **[NestJS](https://nestjs.com/)**: Progressive Node.js framework for building efficient and scalable server-side applications.
- **[Prisma](https://www.prisma.io/)**: Modern ORM for Node.js and TypeScript.
- **[TypeScript](https://www.typescriptlang.org/)**: Typed superset of JavaScript.
- **[PostgreSQL](https://www.postgresql.org/)**: Robust relational database.
- **[Jest](https://jestjs.io/)**: Delightful JavaScript Testing Framework.
- **[Node Mailer](https://nodemailer.com/)**: For sending transactional emails.
- **[Google Cloud Storage](https://cloud.google.com/storage)**: For managing file uploads.

## 🛡️ Security

Security is a priority in the Vitaflow backend. We implement:

- **JWT Authentication**: Robust route protection using JSON Web Tokens.
- **Custom Guards**: `ApiKeyGuard` for internal services and `AuthGuard` for session validation.
- **Password Hashing**: Using Bcrypt for secure credential storage.
- **Data Validation**: Global validation pipes with `class-validator` to ensure data integrity.

## 🛠️ Installation and Setup

Follow the steps below to run the project locally.

### 1. Prerequisites

Ensure you have installed:

- **Node.js** (v18 or higher)
- **NPM** or **Yarn**
- **PostgreSQL** (Running locally or via Docker)

### 2. Environment Variables

Create a `.env` file in the project root and configure the following variables (based on `.env.example` if available):

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/vitaflow_db?schema=public"

# Authentication
JWT_SECRET="your-secure-jwt-secret"
APPLICATION_SECRET="secret-for-api-key-guard"

# Port Configuration (Optional)
PORT=3333

# Other services (Examples)
MAIL_HOST=smtp.example.com
MAIL_USER=user@example.com
MAIL_PASS=password
```

### 3. Running the Project

Install dependencies:

```bash
npm install
```

Generate Prisma artifacts:

```bash
npx prisma generate
```

(Optional) Run migrations to create database tables:

```bash
npx prisma migrate dev
```

Start the development server:

```bash
npm run start:dev
```

The server will be running at `http://localhost:3333` (or the port defined in `.env`).

## 📂 Project Structure

The folder structure follows NestJS modular patterns:

```
src/
├── auth/           # Guards and authorization logic
├── common/         # Global decorators, filters, and interceptors
├── config/         # Environment configurations
├── database/       # Prisma configuration
├── modules/        # Feature modules (Users, Clients, Products)
├── repositories/   # Data access layer
├── utils/          # Utility functions and helpers
├── app.module.ts   # Root application module
└── main.ts         # Application entry point
```

## 📝 Available Scripts

- `npm run start`: Starts the application in production mode.
- `npm run start:dev`: Starts the application in development mode (watch).
- `npm run build`: Compiles the project to the `dist` folder.
- `npm run test`: Runs unit tests via Jest.
- `npm run test:cov`: Generates test coverage report.
- `npm run lint`: Runs ESLint to check and fix code issues.
- `npm run format`: Formats code using Prettier.

## 🤝 Contribution

Contributions are welcome! Feel free to open issues or submit pull requests.

1. Fork the project
2. Create a Branch for your Feature (`git checkout -b feature/MyFeature`)
3. Commit your changes (`git commit -m 'Add MyFeature'`)
4. Push to the Branch (`git push origin feature/MyFeature`)
5. Open a Pull Request

---

<p align="center">
  Developed with ❤️ by the Vitaflow team
</p>
