-- CreateTable
CREATE TABLE "Turma" (
    "id" TEXT NOT NULL,
    "academiaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "professionalId" TEXT,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Turma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurmaEnrollment" (
    "id" TEXT NOT NULL,
    "turmaId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurmaEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurmaSession" (
    "id" TEXT NOT NULL,
    "turmaId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurmaSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Turma_academiaId_idx" ON "Turma"("academiaId");

-- CreateIndex
CREATE UNIQUE INDEX "TurmaEnrollment_turmaId_clientId_key" ON "TurmaEnrollment"("turmaId", "clientId");

-- CreateIndex
CREATE INDEX "TurmaSession_turmaId_startAt_idx" ON "TurmaSession"("turmaId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "TurmaSession_turmaId_startAt_key" ON "TurmaSession"("turmaId", "startAt");

-- AddForeignKey
ALTER TABLE "Turma" ADD CONSTRAINT "Turma_academiaId_fkey" FOREIGN KEY ("academiaId") REFERENCES "Academia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Turma" ADD CONSTRAINT "Turma_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurmaEnrollment" ADD CONSTRAINT "TurmaEnrollment_turmaId_fkey" FOREIGN KEY ("turmaId") REFERENCES "Turma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurmaEnrollment" ADD CONSTRAINT "TurmaEnrollment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurmaSession" ADD CONSTRAINT "TurmaSession_turmaId_fkey" FOREIGN KEY ("turmaId") REFERENCES "Turma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
