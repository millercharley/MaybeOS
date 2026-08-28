/**
 * Drive a written report end to end against whatever DATABASE_URL points at.
 *
 * Exists because the composer's unit tests check the rules against sentences
 * a human wrote, which proves the checks work and proves nothing about what
 * the model actually produces. This is the only way to find that out short of
 * a co-op doing it.
 *
 *   npx ts-node scripts/compose-smoke.ts <org-slug>
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/config/prisma.service';
import { ReportService } from '../src/modules/impact/report.service';
import { ComposerService } from '../src/modules/impact/composer.service';

async function main() {
  const slug = process.argv[2] ?? 'sunrise';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  const prisma = app.get(PrismaService);
  const reports = app.get(ReportService);
  const composer = app.get(ComposerService);

  console.log(`composer configured: ${composer.available}`);

  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!org) throw new Error(`No org with slug "${slug}"`);

  const admin = await prisma.userOrg.findFirst({ where: { orgId: org.id, role: 'ADMIN' }, select: { userId: true } });

  console.log(`\n--- generating a WRITTEN report for ${org.name} ---`);
  const report = await reports.generate(org.id, admin!.userId, { tier: 'WRITTEN' });
  console.log(`report ${report.id} · ${report.blocks.length} blocks · composeStatus=${(report as any).composeStatus}`);

  console.log(`\n--- deterministic bodies (what a co-op has before any model runs) ---`);
  for (const b of report.blocks) {
    console.log(`\n[${b.kind}] ${b.heading ?? ''}\n${b.body}`);
  }

  console.log(`\n--- composing ---`);
  const outcome = await reports.compose(org.id, report.id);
  console.log(JSON.stringify(outcome, null, 2));

  const after = await prisma.impactReport.findUnique({
    where: { id: report.id },
    include: { blocks: { orderBy: { sortOrder: 'asc' } } },
  });
  console.log(`\ncomposeStatus=${after!.composeStatus}  note=${after!.composeNote ?? '—'}`);

  if (after!.composeStatus === 'READY') {
    console.log(`\n--- what the model wrote ---`);
    for (const b of after!.blocks) {
      console.log(`\n[${b.kind}] ${b.heading ?? ''}\n${b.body}`);
    }
  } else {
    console.log(`\n--- the report is still readable; bodies unchanged ---`);
    const unchanged = after!.blocks.every(
      (b, i) => b.body === report.blocks[i].body,
    );
    console.log(`every block identical to the deterministic version: ${unchanged}`);
  }

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
