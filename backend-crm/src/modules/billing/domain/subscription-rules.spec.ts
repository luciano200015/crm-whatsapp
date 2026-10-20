import {
  FEATURES,
  FEATURE_KEYS,
  PLANS,
  PLAN_CODES,
  isPlanCode,
} from './plan-catalog';
import {
  addInterval,
  effectiveStatus,
  fitsLimit,
  hasFullAccess,
  trialDaysLeft,
  trialWindow,
  yearlySavingsPercent,
} from './subscription-rules';

const NOW = new Date('2026-10-19T12:00:00Z');
const at = (iso: string) => new Date(iso);
const base = {
  status: 'TRIALING' as const,
  trialEndsAt: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

describe('effectiveStatus', () => {
  it('keeps a running trial', () => {
    expect(
      effectiveStatus(
        { ...base, trialEndsAt: at('2026-10-20T00:00:00Z') },
        NOW,
      ),
    ).toBe('TRIALING');
  });

  it('expires a trial past its end', () => {
    expect(effectiveStatus({ ...base, trialEndsAt: NOW }, NOW)).toBe('EXPIRED');
  });

  it('marks an ended paid period as past due, or canceled if requested', () => {
    const ended = {
      ...base,
      status: 'ACTIVE' as const,
      currentPeriodEnd: at('2026-10-01T00:00:00Z'),
    };
    expect(effectiveStatus(ended, NOW)).toBe('PAST_DUE');
    expect(effectiveStatus({ ...ended, cancelAtPeriodEnd: true }, NOW)).toBe(
      'CANCELED',
    );
  });

  it('keeps an active period that has not ended', () => {
    expect(
      effectiveStatus(
        {
          ...base,
          status: 'ACTIVE',
          currentPeriodEnd: at('2026-11-19T12:00:00Z'),
        },
        NOW,
      ),
    ).toBe('ACTIVE');
  });

  it('gives full access only while trialing or active', () => {
    expect(hasFullAccess('TRIALING')).toBe(true);
    expect(hasFullAccess('ACTIVE')).toBe(true);
    for (const status of [
      'EXPIRED',
      'PAST_DUE',
      'CANCELED',
      'INCOMPLETE',
    ] as const) {
      expect(hasFullAccess(status)).toBe(false);
    }
  });
});

describe('trial', () => {
  it('builds a window of N days, or none when disabled', () => {
    expect(trialWindow(NOW, 7)).toEqual({
      startsAt: NOW,
      endsAt: at('2026-10-26T12:00:00Z'),
    });
    expect(trialWindow(NOW, 0)).toBeNull();
  });

  it('counts days left rounding up', () => {
    const trial = { ...base, trialEndsAt: at('2026-10-21T13:00:00Z') };
    expect(trialDaysLeft(trial, NOW)).toBe(3);
    expect(trialDaysLeft({ ...trial, trialEndsAt: NOW }, NOW)).toBe(0);
  });
});

describe('addInterval', () => {
  it.each([
    ['2026-01-31T10:00:00Z', 'MONTH', '2026-02-28T10:00:00Z'],
    ['2028-01-31T10:00:00Z', 'MONTH', '2028-02-29T10:00:00Z'],
    ['2026-03-15T00:00:00Z', 'MONTH', '2026-04-15T00:00:00Z'],
    ['2026-12-31T00:00:00Z', 'MONTH', '2027-01-31T00:00:00Z'],
    ['2028-02-29T00:00:00Z', 'YEAR', '2029-02-28T00:00:00Z'],
    ['2026-10-19T12:00:00Z', 'YEAR', '2027-10-19T12:00:00Z'],
  ] as const)('%s + 1 %s = %s', (start, interval, expected) => {
    expect(addInterval(at(start), interval).toISOString()).toBe(
      at(expected).toISOString(),
    );
  });
});

describe('pricing helpers', () => {
  it('computes yearly savings (pay 10 months, get 12)', () => {
    expect(yearlySavingsPercent(9_900, 99_000)).toBe(17);
    expect(yearlySavingsPercent(10_000, 100_000)).toBe(17);
    expect(yearlySavingsPercent(0, 0)).toBe(0);
  });

  it('checks usage against limits (null = unlimited)', () => {
    expect(fitsLimit(3, 3)).toBe(true);
    expect(fitsLimit(4, 3)).toBe(false);
    expect(fitsLimit(10_000, null)).toBe(true);
  });
});

describe('plan catalog', () => {
  it('defines every feature in every plan', () => {
    for (const code of PLAN_CODES) {
      expect(Object.keys(PLANS[code].features).sort()).toEqual(
        [...FEATURE_KEYS].sort(),
      );
    }
  });

  it('uses values that match each feature kind', () => {
    for (const code of PLAN_CODES) {
      for (const [key, value] of Object.entries(PLANS[code].features)) {
        const kind = FEATURES[key as keyof typeof FEATURES].kind;
        if (kind === 'LIMIT')
          expect(
            value === null ||
              (Number.isInteger(value) && (value as number) >= 0),
          ).toBe(true);
        if (kind === 'BOOLEAN') expect(typeof value).toBe('boolean');
        if (kind === 'TEXT')
          expect(value === null || typeof value === 'string').toBe(true);
      }
    }
  });

  it('has monthly and yearly prices in integer cents for every plan', () => {
    for (const code of PLAN_CODES) {
      const byCurrency: Record<string, Record<string, number>> = PLANS[code]
        .prices;
      for (const prices of Object.values(byCurrency)) {
        const month = prices.MONTH ?? -1;
        const year = prices.YEAR ?? -1;
        expect(Number.isInteger(month) && month > 0).toBe(true);
        expect(Number.isInteger(year) && year > 0).toBe(true);
        expect(year).toBeLessThan(month * 12);
      }
    }
  });

  it('never lowers a limit when moving to a more expensive plan', () => {
    for (let i = 1; i < PLAN_CODES.length; i++) {
      const cheaper = PLANS[PLAN_CODES[i - 1]!].features;
      const pricier = PLANS[PLAN_CODES[i]!].features;
      for (const key of FEATURE_KEYS) {
        if (FEATURES[key].kind !== 'LIMIT') continue;
        const a = cheaper[key] as number | null;
        const b = pricier[key] as number | null;
        expect(b === null || (a !== null && b >= a)).toBe(true);
      }
    }
  });

  it('accepts only known plan codes', () => {
    expect(isPlanCode('team')).toBe(true);
    expect(isPlanCode('toString')).toBe(false);
  });
});
