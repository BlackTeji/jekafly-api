CREATE TABLE IF NOT EXISTS "page_views" (
    "id"          TEXT NOT NULL,
    "page"        TEXT NOT NULL,
    "referrer"    TEXT,
    "sessionId"   TEXT,
    "userId"      TEXT,
    "duration"    INTEGER,
    "scrollDepth" INTEGER,
    "ip"          TEXT,
    "userAgent"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "page_views_page_idx"      ON "page_views"("page");
CREATE INDEX IF NOT EXISTS "page_views_sessionId_idx" ON "page_views"("sessionId");
CREATE INDEX IF NOT EXISTS "page_views_createdAt_idx" ON "page_views"("createdAt");
CREATE INDEX IF NOT EXISTS "page_views_userId_idx"    ON "page_views"("userId");