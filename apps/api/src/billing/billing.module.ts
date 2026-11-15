import { Module } from '@nestjs/common';
import { CyclesService } from './cycles.service.js';
import { InvoicesController } from './invoices.controller.js';
import { UnpaidService } from './unpaid.service.js';

@Module({
  controllers: [InvoicesController],
  providers: [CyclesService, UnpaidService],
  exports: [CyclesService, UnpaidService],
})
export class BillingModule {}
