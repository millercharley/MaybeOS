import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { StripeService } from '../stripe.service';
import { PrismaService } from '../../../config/prisma.service';

jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: jest.fn(),
    },
    customers: { create: jest.fn() },
    checkout: { sessions: { create: jest.fn() } },
    billingPortal: { sessions: { create: jest.fn() } },
    subscriptions: { retrieve: jest.fn() },
    products: { create: jest.fn() },
    prices: { create: jest.fn() },
  }));
});

describe('StripeService', () => {
  let service: StripeService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                STRIPE_SECRET_KEY: 'sk_test_fake',
                STRIPE_WEBHOOK_SECRET: 'whsec_test',
              };
              return config[key] || '';
            }),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            webhookEvent: {
              findUnique: jest.fn(),
              create: jest.fn(),
            },
            userOrg: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
            },
            membershipTier: {
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<StripeService>(StripeService);
    prisma = module.get(PrismaService);
  });

  describe('handleWebhook', () => {
    it('should throw BadRequestException on invalid signature', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(
        service.handleWebhook(Buffer.from('body'), 'bad-sig'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should skip already-processed events (database idempotency)', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_already_processed',
        type: 'customer.subscription.created',
        data: { object: {} },
      });

      prisma.webhookEvent.findUnique.mockResolvedValue({
        id: 'evt_already_processed',
        source: 'stripe',
        processedAt: new Date(),
      });

      const result = await service.handleWebhook(Buffer.from('body'), 'valid-sig');

      expect(result).toEqual({ received: true });
      expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    });

    it('should process subscription.created and record idempotency', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_new',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_123',
            metadata: { orgId: 'org-1', userId: 'user-1', tierId: 'tier-1' },
          },
        },
      });

      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt_new' });
      prisma.userOrg.update.mockResolvedValue({});

      const result = await service.handleWebhook(Buffer.from('body'), 'valid-sig');

      expect(result).toEqual({ received: true });
      expect(prisma.userOrg.update).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: 'user-1', orgId: 'org-1' } },
        data: {
          stripeSubscriptionId: 'sub_123',
          subscriptionStatus: 'ACTIVE',
          tierId: 'tier-1',
        },
      });
      expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
        data: { id: 'evt_new', source: 'stripe' },
      });
    });

    it('should process subscription.deleted and mark as CANCELED', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_del',
        type: 'customer.subscription.deleted',
        data: {
          object: { id: 'sub_456', metadata: {} },
        },
      });

      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt_del' });
      prisma.userOrg.findFirst.mockResolvedValue({ id: 'uo-1', userId: 'u1', orgId: 'o1' });
      prisma.userOrg.update.mockResolvedValue({});

      const result = await service.handleWebhook(Buffer.from('body'), 'valid-sig');

      expect(result).toEqual({ received: true });
      expect(prisma.userOrg.update).toHaveBeenCalledWith({
        where: { id: 'uo-1' },
        data: { subscriptionStatus: 'CANCELED' },
      });
    });

    it('should handle unrecognized event types gracefully', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_unknown',
        type: 'payment_intent.succeeded',
        data: { object: {} },
      });

      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt_unknown' });

      const result = await service.handleWebhook(Buffer.from('body'), 'valid-sig');

      expect(result).toEqual({ received: true });
      expect(prisma.webhookEvent.create).toHaveBeenCalled();
    });

    it('should still record idempotency even if handler throws', async () => {
      const stripe = (service as any).stripe;
      stripe.webhooks.constructEvent.mockReturnValue({
        id: 'evt_err',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_bad',
            metadata: { orgId: 'org-1', userId: 'user-1' },
          },
        },
      });

      prisma.webhookEvent.findUnique.mockResolvedValue(null);
      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt_err' });
      prisma.userOrg.update.mockRejectedValue(new Error('DB error'));

      const result = await service.handleWebhook(Buffer.from('body'), 'valid-sig');

      expect(result).toEqual({ received: true });
      expect(prisma.webhookEvent.create).toHaveBeenCalled();
    });
  });
});
