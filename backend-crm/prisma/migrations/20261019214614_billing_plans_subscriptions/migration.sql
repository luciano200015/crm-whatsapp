-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "FeatureKind" AS ENUM ('LIMIT', 'BOOLEAN', 'TEXT');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'INCOMPLETE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "tagline" VARCHAR(160),
    "description" VARCHAR(500),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_highlighted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "interval" "BillingInterval" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "features" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "kind" "FeatureKind" NOT NULL,
    "unit" VARCHAR(40),
    "group" VARCHAR(40),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "features_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_features" (
    "plan_id" UUID NOT NULL,
    "feature_id" UUID NOT NULL,
    "limit_value" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "text_value" VARCHAR(80),

    CONSTRAINT "plan_features_pkey" PRIMARY KEY ("plan_id","feature_id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "price_id" UUID,
    "interval" "BillingInterval" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "trial_started_at" TIMESTAMPTZ(3),
    "trial_ends_at" TIMESTAMPTZ(3),
    "current_period_start" TIMESTAMPTZ(3),
    "current_period_end" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMPTZ(3),
    "provider" VARCHAR(32) NOT NULL DEFAULT 'none',
    "provider_reference" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_plan_id_interval_currency_key" ON "plan_prices"("plan_id", "interval", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "features_key_key" ON "features"("key");

-- CreateIndex
CREATE INDEX "plan_features_feature_id_idx" ON "plan_features"("feature_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_workspace_id_key" ON "subscriptions"("workspace_id");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_trial_ends_at_idx" ON "subscriptions"("status", "trial_ends_at");

-- CreateIndex
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "features"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "plan_prices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Hand-written constraints (not expressible in schema.prisma) ───
ALTER TABLE "plans" ADD CONSTRAINT "plans_code_format_check" CHECK ("code" ~ '^[a-z][a-z0-9_-]{1,49}$');
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_amount_check" CHECK ("amount_cents" >= 0);
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_limit_check" CHECK ("limit_value" IS NULL OR "limit_value" >= 0);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_amount_check" CHECK ("amount_cents" >= 0);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
-- A trial always has both ends, and ends after it starts.
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_trial_check" CHECK (
  ("trial_started_at" IS NULL AND "trial_ends_at" IS NULL)
  OR ("trial_started_at" IS NOT NULL AND "trial_ends_at" > "trial_started_at")
);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_period_check" CHECK (
  ("current_period_start" IS NULL AND "current_period_end" IS NULL)
  OR ("current_period_start" IS NOT NULL AND "current_period_end" > "current_period_start")
);
