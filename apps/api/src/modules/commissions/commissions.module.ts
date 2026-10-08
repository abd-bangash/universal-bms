import { Module, type OnModuleInit } from '@nestjs/common';
import { WorkflowRegistry } from '../workflows/workflow.registry';
import { CommissionsController, StaffCommissionController } from './commissions.controller';
import { CommissionsListener } from './commissions.listener';
import { CommissionsService } from './commissions.service';

/** Commission rules, calculation, approval and payment (tasks 59 to 62). */
@Module({
  controllers: [CommissionsController, StaffCommissionController],
  providers: [CommissionsService, CommissionsListener],
  exports: [CommissionsService],
})
export class CommissionsModule implements OnModuleInit {
  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly commissions: CommissionsService,
  ) {}

  onModuleInit(): void {
    // Cancelling an order takes its commissions back, in the same transaction (Requirement 14.6)
    this.registry.registerSideEffect('ORDER', 'CANCELLED', ({ tx, record }) =>
      this.commissions.reverseForOrder(tx, record.id).then(() => undefined),
    );
  }
}
