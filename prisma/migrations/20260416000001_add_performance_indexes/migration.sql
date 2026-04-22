-- Performance indexes using quoted camelCase column names (Prisma convention)

-- Applications
CREATE INDEX IF NOT EXISTS "applications_userId_idx" ON "applications"("userId");
CREATE INDEX IF NOT EXISTS "applications_status_idx" ON "applications"("status");
CREATE INDEX IF NOT EXISTS "applications_referralCode_idx" ON "applications"("referralCode");
CREATE INDEX IF NOT EXISTS "applications_createdAt_idx" ON "applications"("createdAt");
CREATE INDEX IF NOT EXISTS "applications_userId_status_idx" ON "applications"("userId", "status");

-- Status history
CREATE INDEX IF NOT EXISTS "status_history_applicationId_idx" ON "status_history"("applicationId");
CREATE INDEX IF NOT EXISTS "status_history_createdAt_idx" ON "status_history"("createdAt");

-- Documents
CREATE INDEX IF NOT EXISTS "documents_userId_idx" ON "documents"("userId");
CREATE INDEX IF NOT EXISTS "documents_applicationId_idx" ON "documents"("applicationId");

-- Payments (uses applicationId not applicationRef)
CREATE INDEX IF NOT EXISTS "payments_applicationId_idx" ON "payments"("applicationId");
CREATE INDEX IF NOT EXISTS "payments_userId_idx" ON "payments"("userId");
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments"("status");

-- Affiliates
CREATE INDEX IF NOT EXISTS "affiliates_userId_idx" ON "affiliates"("userId");
CREATE INDEX IF NOT EXISTS "affiliates_status_idx" ON "affiliates"("status");

-- Affiliate payouts
CREATE INDEX IF NOT EXISTS "affiliate_payouts_affiliateId_idx" ON "affiliate_payouts"("affiliateId");
CREATE INDEX IF NOT EXISTS "affiliate_payouts_status_idx" ON "affiliate_payouts"("status");

-- Refresh tokens
CREATE INDEX IF NOT EXISTS "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");
CREATE INDEX IF NOT EXISTS "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- Reviews
CREATE INDEX IF NOT EXISTS "reviews_approved_idx" ON "reviews"("approved");
CREATE INDEX IF NOT EXISTS "reviews_userId_idx" ON "reviews"("userId");