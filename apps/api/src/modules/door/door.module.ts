import { Module } from '@nestjs/common';
import { DoorService } from './door.service';
import { DoorSheetService } from './door-sheet.service';
import { DoorController } from './door.controller';
import { EmailModule } from '../email/email.module';

/**
 * Door codes and the sheet a co-op's door application reads (DOR-01).
 */
@Module({
  imports: [EmailModule],
  controllers: [DoorController],
  providers: [DoorService, DoorSheetService],
  // The scheduler runs the reconciliation pass.
  exports: [DoorService, DoorSheetService],
})
export class DoorModule {}
