import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { DuplicateCandidate } from './customer.support';

const SIMILARITY = 0.6;
const MAX_CANDIDATES = 5;

type Rule = 'PHONE' | 'EMAIL' | 'NAME_SIMILAR';

/** Finds customers that look like the one being saved, using the workspace's `duplicates.matchOn` rules. */
@Injectable()
export class DuplicateDetectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async find(input: {
    phonesNormalized: readonly string[];
    email?: string | null;
    fullName?: string | null;
    excludeId?: string;
  }): Promise<DuplicateCandidate[]> {
    const rules = new Set(await this.settings.get<Rule[]>('duplicates.matchOn'));
    const workspaceId = this.cls.get('workspaceId');
    if (!workspaceId) throw new Error('No workspace in context');
    const reasons = new Map<string, Set<Rule>>();
    const note = (id: string, rule: Rule) => {
      const set = reasons.get(id) ?? new Set<Rule>();
      set.add(rule);
      reasons.set(id, set);
    };
    const base = {
      isWalkIn: false,
      status: 'ACTIVE',
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    };

    if (rules.has('PHONE') && input.phonesNormalized.length > 0) {
      const rows = await this.prisma.scoped.customer.findMany({
        where: { ...base, phonesNormalized: { hasSome: [...input.phonesNormalized] } },
        select: { id: true },
        take: 20,
      });
      for (const r of rows) note(r.id, 'PHONE');
    }
    if (rules.has('EMAIL') && input.email) {
      const rows = await this.prisma.scoped.customer.findMany({
        where: { ...base, email: input.email },
        select: { id: true },
        take: 20,
      });
      for (const r of rows) note(r.id, 'EMAIL');
    }
    if (rules.has('NAME_SIMILAR') && input.fullName && input.fullName.trim().length >= 3) {
      const exclude = input.excludeId ? Prisma.sql`AND id <> ${input.excludeId}` : Prisma.empty;
      const rows = await this.prisma.scoped.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM customers
        WHERE workspace_id = ${workspaceId} AND NOT is_walk_in AND status = 'ACTIVE' ${exclude}
          AND similarity(full_name, ${input.fullName.trim()}) >= ${SIMILARITY}
        ORDER BY similarity(full_name, ${input.fullName.trim()}) DESC LIMIT 20`;
      for (const r of rows) note(r.id, 'NAME_SIMILAR');
    }
    if (reasons.size === 0) return [];

    const customers = await this.prisma.scoped.customer.findMany({
      where: { id: { in: [...reasons.keys()] } },
    });
    const order: Rule[] = ['PHONE', 'EMAIL', 'NAME_SIMILAR'];
    return customers
      .map((c) => ({
        id: c.id,
        fullName: c.fullName,
        phones: c.phones,
        email: c.email,
        reasons: order.filter((rule) => reasons.get(c.id)?.has(rule)),
      }))
      .sort((a, b) => b.reasons.length - a.reasons.length || a.fullName.localeCompare(b.fullName))
      .slice(0, MAX_CANDIDATES);
  }
}
