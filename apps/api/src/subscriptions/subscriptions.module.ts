import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { LessonsModule } from '../lessons/lessons.module.js';
import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';

@Module({
  imports: [BillingModule, LessonsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
