import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../../config/prisma.service';

/**
 * Resolves tenant from subdomain or X-Org-Slug header and attaches org to request.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const slug =
      req.headers['x-org-slug'] as string ||
      this.extractSubdomain(req.hostname);

    if (slug) {
      const org = await this.prisma.organization.findUnique({
        where: { slug },
        select: { id: true, slug: true, name: true, settings: true },
      });

      if (org) {
        (req as Record<string, unknown>).org = org;
        (req as Record<string, unknown>).orgId = org.id;
      }
    }

    next();
  }

  private extractSubdomain(hostname: string): string | null {
    const parts = hostname.split('.');
    if (parts.length >= 3) {
      return parts[0];
    }
    return null;
  }
}
