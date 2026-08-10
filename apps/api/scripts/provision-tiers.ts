/**
 * Backfill Stripe Products and Prices for membership tiers that don't have
 * them.
 *
 * Needed because `createStripePricesForTier` was dead code until 2026-08-10 —
 * nothing called it — so every tier created before then has a null
 * `stripePriceIdMonthly` and cannot be purchased. New tiers are provisioned on
 * creation; this is for the ones that already exist.
 *
 * Safe to re-run: tiers that already have a price are skipped.
 *
 *   npx ts-node scripts/provision-tiers.ts            # dry run
 *   npx ts-node scripts/provision-tiers.ts --apply    # actually create them
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/config/prisma.service';
import { MemberService } from '../src/modules/member/member.service';

async function main() {
  const apply = process.argv.includes('--apply');
  const logger = new Logger('provision-tiers');

  if (!process.env.STRIPE_SECRET_KEY) {
    logger.error('STRIPE_SECRET_KEY is not set — nothing can be provisioned.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const prisma = app.get(PrismaService);
  const members = app.get(MemberService);

  const tiers = await prisma.membershipTier.findMany({
    where: { stripePriceIdMonthly: null },
    orderBy: [{ orgId: 'asc' }, { sortOrder: 'asc' }],
  });

  if (tiers.length === 0) {
    logger.log('Every tier already has a Stripe price. Nothing to do.');
    await app.close();
    return;
  }

  logger.log(
    `${tiers.length} tier(s) without a Stripe price:` +
      tiers.map((t) => `\n  - ${t.name} (org ${t.orgId}, $${t.priceMonthly / 100})`).join(''),
  );

  if (!apply) {
    logger.log('Dry run. Re-run with --apply to create these in Stripe.');
    await app.close();
    return;
  }

  let ok = 0;
  for (const tier of tiers) {
    const provisioned = await members.provisionStripeForTier(tier);
    if (provisioned) {
      ok += 1;
      logger.log(`  provisioned ${tier.name}`);
    } else {
      logger.warn(`  FAILED ${tier.name} — see the warning above`);
    }
  }

  logger.log(`Done: ${ok}/${tiers.length} provisioned.`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
