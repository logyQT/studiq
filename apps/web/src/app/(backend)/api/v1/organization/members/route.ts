import { organizationMemberController } from '@studiq/server/controllers/organization-member.controller';
import { authedRoute } from '@studiq/server/lib/route-handler';

/** The org roster, as `org.member.manage` reaches it. */
export const GET = authedRoute(
  () => [],
  (ctx) =>
    organizationMemberController.listMembers(
      ctx,
      new URL(ctx.url).searchParams.get('role') ?? undefined,
    ),
);

export const PUT = authedRoute(
  ({ json }) => [json],
  (ctx, body) => organizationMemberController.changeRole(ctx, body),
  { readsBody: true },
);

/**
 * A DELETE carries its target in the query, not a body: it declares none, so a
 * refused caller answers 403 instead of the 400 an empty stream would raise.
 */
export const DELETE = authedRoute(
  () => [],
  (ctx) =>
    organizationMemberController.removeMember(
      ctx,
      new URL(ctx.url).searchParams.get('userId') ?? '',
    ),
);
