import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts orgId from route params or query.
 * Usage: @OrgId() orgId: string
 */
export const OrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.params.orgId || request.query.orgId || request.headers['x-org-id'];
  },
);
