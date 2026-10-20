import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { AppConfigService } from '../../../config/app-config.service';
import type { Env } from '../../../config/env.schema';
import type { AuditService } from '../../audit/audit.service';
import { PLANS, type PlanCode } from '../domain/plan-catalog';
import { BillingService } from './billing.service';
import {
  BillingStore,
  PaymentGateway,
  PaymentsUnavailableError,
  type PlanRecord,
  type SubscriptionRecord,
  type SubscriptionWrite,
} from './ports';

const NOW = new Date('2026-10-19T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const WS = 'ws-1';
const actor = {
  userId: 'owner-1',
  context: { ipAddress: null, userAgent: null, requestId: null },
};

function planRecord(code: PlanCode): PlanRecord {
  const definition = PLANS[code];
  return {
    id: `plan-${code}`,
    code,
    name: definition.name,
    tagline: definition.tagline,
    description: definition.description,
    isHighlighted: false,
    isPublic: true,
    isActive: true,
    prices: (['MONTH', 'YEAR'] as const).map((interval) => ({
      id: `price-${code}-${interval}`,
      interval,
      currency: 'USD',
      amountCents: definition.prices.USD[interval],
    })),
    features: definition.features,
  };
}

/** In-memory BillingStore with one workspace. */
class FakeStore extends BillingStore {
  subscription: SubscriptionRecord | null = null;
  members = 1;
  plans = (['team', 'business', 'corporate'] as const).map(planRecord);

  listFeatures() {
    return Promise.resolve([]);
  }
  listPlans() {
    return Promise.resolve(this.plans);
  }
  findPlan(code: string) {
    return Promise.resolve(this.plans.find((p) => p.code === code) ?? null);
  }
  findPlanById(id: string) {
    return Promise.resolve(this.plans.find((p) => p.id === id) ?? null);
  }
  findSubscription() {
    return Promise.resolve(this.subscription);
  }
  saveSubscription(workspaceId: string, data: SubscriptionWrite) {
    const plan = this.plans.find((p) => p.id === data.planId)!;
    this.subscription = {
      id: 'sub-1',
      workspaceId,
      plan: { id: plan.id, code: plan.code, name: plan.name },
      ...data,
    };
    return Promise.resolve(this.subscription);
  }
  updateSubscription(workspaceId: string, data: Partial<SubscriptionWrite>) {
    const current = this.subscription!;
    const plan = this.plans.find(
      (p) => p.id === (data.planId ?? current.plan.id),
    )!;
    this.subscription = {
      ...current,
      ...data,
      plan: { id: plan.id, code: plan.code, name: plan.name },
    };
    return Promise.resolve(this.subscription);
  }
  countActiveMembers() {
    return Promise.resolve(this.members);
  }
}

function setup(options: { payments?: boolean; trialDays?: number } = {}) {
  const store = new FakeStore();
  const payments = {
    enabled: options.payments !== false,
    charge: jest.fn(() =>
      options.payments === false
        ? Promise.reject(new PaymentsUnavailableError())
        : Promise.resolve({ provider: 'simulated', reference: 'sim_1' }),
    ),
  } as unknown as PaymentGateway & { charge: jest.Mock };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const values: Partial<Env> = {
    BILLING_CURRENCY: 'USD',
    BILLING_TRIAL_DAYS: options.trialDays ?? 7,
    BILLING_DEFAULT_PLAN: 'team',
    BILLING_DEFAULT_INTERVAL: 'MONTH',
  };
  const config = { get: (key: keyof Env) => values[key] } as AppConfigService;
  const clock = { now: () => NOW };
  const service = new BillingService(
    store,
    payments,
    audit as unknown as AuditService,
    config,
    clock,
  );
  return { service, store, payments, audit };
}

async function startTrial(
  store: FakeStore,
  code: PlanCode = 'team',
  trialEndsAt = days(7),
) {
  const plan = planRecord(code);
  await store.saveSubscription(WS, {
    planId: plan.id,
    priceId: `price-${code}-MONTH`,
    interval: 'MONTH',
    amountCents: PLANS[code].prices.USD.MONTH,
    currency: 'USD',
    status: 'TRIALING',
    trialStartedAt: days(-1),
    trialEndsAt,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    provider: 'none',
    providerReference: null,
  });
}

describe('BillingService', () => {
  describe('forSignup', () => {
    it('gives the default (basic) plan with the configured trial', async () => {
      const { service } = setup();

      await expect(service.forSignup()).resolves.toEqual({
        planId: 'plan-team',
        priceId: 'price-team-MONTH',
        interval: 'MONTH',
        amountCents: 9_900,
        currency: 'USD',
        status: 'TRIALING',
        trialStartedAt: NOW,
        trialEndsAt: days(7),
      });
    });

    it('honors the plan chosen on the pricing page', async () => {
      const { service } = setup();
      await expect(
        service.forSignup('corporate', 'YEAR'),
      ).resolves.toMatchObject({
        planId: 'plan-corporate',
        interval: 'YEAR',
        amountCents: 599_000,
      });
    });

    it('starts INCOMPLETE when the trial is disabled', async () => {
      const { service } = setup({ trialDays: 0 });
      await expect(service.forSignup()).resolves.toMatchObject({
        status: 'INCOMPLETE',
        trialStartedAt: null,
        trialEndsAt: null,
      });
    });

    it('rejects unknown or private plans', async () => {
      const { service, store } = setup();
      await expect(service.forSignup('platinum')).rejects.toBeInstanceOf(
        BadRequestException,
      );

      store.plans[1]!.isPublic = false;
      await expect(service.forSignup('business')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('getSubscription', () => {
    it('reports trial days left and agent usage against the limit', async () => {
      const { service, store } = setup();
      await startTrial(store);
      store.members = 2;

      const view = await service.getSubscription(WS);

      expect(view).toMatchObject({
        status: 'TRIALING',
        trialDaysLeft: 7,
        hasFullAccess: true,
      });
    });

    it('expires a trial past its end and persists the new status', async () => {
      const { service, store } = setup();
      await startTrial(store, 'team', days(-1));

      const view = await service.getSubscription(WS);

      expect(view).toMatchObject({
        status: 'EXPIRED',
        hasFullAccess: false,
        trialDaysLeft: 0,
      });
      expect(store.subscription?.status).toBe('EXPIRED');
    });
  });

  describe('changePlan', () => {
    it('switches plan during the trial without charging and keeps the trial end', async () => {
      const { service, store, payments } = setup();
      await startTrial(store);

      const view = await service.changePlan(
        WS,
        { planCode: 'business', interval: 'YEAR' },
        actor,
      );

      expect(view).toMatchObject({
        plan: { code: 'business' },
        interval: 'YEAR',
        status: 'TRIALING',
        trialEndsAt: days(7),
        amountCents: 229_000,
      });
      expect(payments.charge).not.toHaveBeenCalled();
    });

    it('charges and starts a paid period once the trial expired', async () => {
      const { service, store, payments, audit } = setup();
      await startTrial(store, 'team', days(-1));

      const view = await service.changePlan(
        WS,
        { planCode: 'business', interval: 'MONTH' },
        actor,
      );

      expect(payments.charge).toHaveBeenCalledWith(
        expect.objectContaining({ planCode: 'business', amountCents: 22_900 }),
      );
      expect(view).toMatchObject({
        status: 'ACTIVE',
        currentPeriodStart: NOW,
        currentPeriodEnd: new Date('2026-11-19T12:00:00Z'),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.plan.changed' }),
      );
    });

    it('answers 402 when payments are disabled and nothing changes', async () => {
      const { service, store } = setup({ payments: false });
      await startTrial(store, 'team', days(-1));

      const error = await service
        .changePlan(WS, { planCode: 'business', interval: 'MONTH' }, actor)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.PAYMENT_REQUIRED,
      );
      expect(store.subscription?.plan.code).toBe('team');
    });

    it('refuses a downgrade that does not fit the current members', async () => {
      const { service, store } = setup();
      await startTrial(store, 'business');
      store.members = 4; // team allows 3 agents

      await expect(
        service.changePlan(WS, { planCode: 'team', interval: 'MONTH' }, actor),
      ).rejects.toThrow(/allows 3 agents/);
    });

    it('refuses a no-op change', async () => {
      const { service, store } = setup();
      await startTrial(store);

      await expect(
        service.changePlan(WS, { planCode: 'team', interval: 'MONTH' }, actor),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('activate, cancel and resume', () => {
    it('activates the trial plan early with a paid period', async () => {
      const { service, store } = setup();
      await startTrial(store);

      await expect(service.activate(WS, actor)).resolves.toMatchObject({
        status: 'ACTIVE',
        plan: { code: 'team' },
      });
      await expect(service.activate(WS, actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('ends a trial immediately when canceled', async () => {
      const { service, store } = setup();
      await startTrial(store);

      await expect(service.cancel(WS, actor)).resolves.toMatchObject({
        status: 'CANCELED',
        hasFullAccess: false,
      });
    });

    it('keeps a paid plan until the period ends, and can resume it', async () => {
      const { service, store } = setup();
      await startTrial(store);
      await service.activate(WS, actor);

      await expect(service.cancel(WS, actor)).resolves.toMatchObject({
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
      });
      await expect(service.cancel(WS, actor)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(service.resume(WS, actor)).resolves.toMatchObject({
        cancelAtPeriodEnd: false,
      });
    });
  });
});
