import type { RequestContext } from '../../../shared/http/request-context';
import type { WorkspaceAccess } from '../../authorization/application/authorization.service';
import type { PermissionKey } from '../../authorization/domain/permission-catalog';
import { missingPermissions } from '../domain/team-rules';
import { WorkspaceEntitlements, type WorkspaceEntitlementsView } from './ports';
import { TeamErrors } from './team-errors';

/** Who is acting: their access in the workspace (from the guard) and the request. */
export interface TeamActor {
  userId: string;
  access: WorkspaceAccess;
  context: RequestContext;
}

/** Throws ROLE_ESCALATION unless the actor holds every permission. */
export function assertHolds(
  actor: TeamActor,
  permissions: Iterable<PermissionKey>,
): void {
  const missing = missingPermissions(permissions, actor.access.permissions);
  if (missing.length > 0) throw TeamErrors.escalation(missing);
}

/** The plan of the workspace; a workspace without one is treated as inactive. */
export async function requirePlan(
  entitlements: WorkspaceEntitlements,
  workspaceId: string,
): Promise<WorkspaceEntitlementsView> {
  const plan = await entitlements.entitlements(workspaceId);
  if (!plan) throw TeamErrors.subscriptionInactive();
  return plan;
}

export function assertCustomRolesIncluded(plan: WorkspaceEntitlementsView) {
  if (plan.features['features.custom_roles'] !== true) {
    throw TeamErrors.featureNotInPlan({
      feature: 'features.custom_roles',
      plan: plan.planName,
    });
  }
}

/** limits.agents of the plan: a number, or null for unlimited. */
export function agentLimit(plan: WorkspaceEntitlementsView): number | null {
  const value = plan.features['limits.agents'];
  return typeof value === 'number' ? value : null;
}
