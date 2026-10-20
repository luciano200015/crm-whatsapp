import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ChargeRequest,
  PaymentGateway,
  PaymentsUnavailableError,
} from '../application/ports';

/** Payments succeed instantly. Development/testing only (refused in production). */
@Injectable()
export class SimulatedPaymentGateway extends PaymentGateway {
  private readonly logger = new Logger(SimulatedPaymentGateway.name);
  readonly enabled = true;

  charge(
    request: ChargeRequest,
  ): Promise<{ provider: string; reference: string }> {
    this.logger.warn(
      `Simulated payment for workspace ${request.workspaceId}: ${request.planCode}/${request.interval} ` +
        `${request.amountCents} ${request.currency}`,
    );
    return Promise.resolve({
      provider: 'simulated',
      reference: `sim_${randomUUID()}`,
    });
  }
}

/** No payment provider configured yet. */
@Injectable()
export class DisabledPaymentGateway extends PaymentGateway {
  readonly enabled = false;

  charge(): Promise<{ provider: string; reference: string }> {
    return Promise.reject(new PaymentsUnavailableError());
  }
}
