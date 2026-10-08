import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Clock } from './clock';

export interface MembershipState {
  permVersion: number;
  active: boolean;
  roleNames: string[];
}

const TTL_MS = 30_000;

/**
 * Current permVersion and status of a membership, cached for 30 seconds so a role change reaches
 * a user's next request within the 60-second rule of Requirement 45.7 without a query per request.
 */
@Injectable()
export class MembershipCache {
  private readonly entries = new Map<string, { state: MembershipState; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async get(membershipId: string): Promise<MembershipState | null> {
    const now = this.clock.now().getTime();
    const hit = this.entries.get(membershipId);
    if (hit && hit.expiresAt > now) return hit.state;

    const row = await this.prisma.unscoped.userWorkspace.findUnique({
      where: { id: membershipId },
      include: {
        workspace: { select: { status: true } },
        user: { select: { status: true } },
        roles: { include: { role: { select: { name: true } } } },
      },
    });
    if (!row) {
      this.entries.delete(membershipId);
      return null;
    }
    const state: MembershipState = {
      permVersion: row.permVersion,
      active:
        row.status === 'ACTIVE' &&
        row.user.status === 'ACTIVE' &&
        row.workspace.status === 'ACTIVE',
      roleNames: row.roles.map((r) => r.role.name).sort(),
    };
    this.entries.set(membershipId, { state, expiresAt: now + TTL_MS });
    return state;
  }

  /** Called by code that changes roles or status in this process, for an immediate effect. */
  invalidate(membershipId?: string): void {
    if (membershipId) this.entries.delete(membershipId);
    else this.entries.clear();
  }
}
