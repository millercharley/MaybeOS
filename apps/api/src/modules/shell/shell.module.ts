import { Module } from '@nestjs/common';
import { ShellController } from './shell.controller';
import { ShellService } from './shell.service';
import { CommonsModule } from '../commons/commons.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { OrgModule } from '../org/org.module';
import { BelongingModule } from '../belonging/belonging.module';

/**
 * A leaf, deliberately (OPS-47).
 *
 * This module imports four others and is imported by nothing, so no cycle is
 * possible from here however the four grow. The alternative — hanging the
 * route off `OrgModule`, which is already imported across the API — would put
 * a cycle one import away: any one of these four gaining a dependency on the
 * org module would close the loop, and the error that produces names a
 * provider rather than the import that caused it.
 *
 * The same reasoning as `HomeModule`, and the same shape.
 */
@Module({
  imports: [CommonsModule, OnboardingModule, OrgModule, BelongingModule],
  controllers: [ShellController],
  providers: [ShellService],
})
export class ShellModule {}
