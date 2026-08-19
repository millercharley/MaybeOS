import { Test, TestingModule } from '@nestjs/testing';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from '../health.controller';
import { PrismaHealthIndicator } from '../prisma.health';
import { EmailHealthIndicator } from '../email.health';
import { StorageHealthIndicator } from '../storage.health';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../config/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        PrismaHealthIndicator,
        EmailHealthIndicator,
        StorageHealthIndicator,
        {
          provide: ConfigService,
          useValue: { get: () => undefined },
        },
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
          },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    prisma = module.get(PrismaService);
  });

  it('should return healthy status when database is up', async () => {
    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.details.database.status).toBe('up');
  });

  it('should return error status when database is down', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

    await expect(controller.check()).rejects.toThrow();
  });
});
