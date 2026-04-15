-- CreateTable: magic_tokens
CREATE TABLE IF NOT EXISTS "magic_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isNewUser" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "magic_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "magic_tokens_token_key" ON "magic_tokens"("token");

-- CreateTable: otp_tokens
CREATE TABLE IF NOT EXISTS "otp_tokens" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "otp_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "otp_tokens_key_key" ON "otp_tokens"("key");