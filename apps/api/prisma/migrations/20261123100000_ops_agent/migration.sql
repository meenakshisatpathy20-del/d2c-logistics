-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentApproval" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "requestedBy" TEXT,
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "AgentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMessage_brandId_createdAt_idx" ON "AgentMessage"("brandId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentApproval_brandId_status_idx" ON "AgentApproval"("brandId", "status");

