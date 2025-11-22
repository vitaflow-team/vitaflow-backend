-- CreateTable
CREATE TABLE "UsersToken" (
    "id" TEXT NOT NULL,
    "userID" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsersToken_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "UsersToken" ADD CONSTRAINT "UsersToken_userID_fkey" FOREIGN KEY ("userID") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
