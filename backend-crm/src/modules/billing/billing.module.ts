import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { Clock, SystemClock } from '../../shared/time/clock';
import { BillingService } from './application/billing.service';
import { BillingStore, PaymentGateway } from './application/ports';
import {
  DisabledPaymentGateway,
  SimulatedPaymentGateway,
} from './infrastructure/payment-gateways';
import { PrismaBillingStore } from './infrastructure/prisma-billing-store';
import {
  BillingCatalogController,
  WorkspaceSubscriptionController,
} from './presentation/billing.controller';

/**
 * Plans, prices, entitlements and workspace subscriptions. Kept independent
 * from auth: auth only asks it which subscription a new workspace starts with.
 */
@Module({
  controllers: [BillingCatalogController, WorkspaceSubscriptionController],
  providers: [
    BillingService,
    { provide: BillingStore, useClass: PrismaBillingStore },
    {
      provide: PaymentGateway,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        config.get('BILLING_PAYMENTS_MODE') === 'simulated'
          ? new SimulatedPaymentGateway()
          : new DisabledPaymentGateway(),
    },
    { provide: Clock, useClass: SystemClock },
  ],
  exports: [BillingService],
})
export class BillingModule {}
