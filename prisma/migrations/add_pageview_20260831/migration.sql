CREATE TABLE "Pageview" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pageview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Pageview_createdAt_idx" ON "Pageview"("createdAt");
CREATE INDEX "Pageview_path_idx" ON "Pageview"("path");
