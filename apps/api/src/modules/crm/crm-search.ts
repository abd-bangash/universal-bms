import { Prisma } from '@prisma/client';
import type { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { SearchProvider } from '../search/search.types';

const workspaceOf = (cls: ClsService<RequestContext>): string => {
  const id = cls.get('workspaceId');
  if (!id) throw new Error('No workspace in context');
  return id;
};

/** Customers: name, email and phone (Requirement 31.1). */
export function customerSearch(
  prisma: PrismaService,
  cls: ClsService<RequestContext>,
): SearchProvider {
  return {
    type: 'CUSTOMER',
    permission: 'customer:view',
    async search(_user, q, limit) {
      const phone = q.phoneDigits
        ? Prisma.sql`OR EXISTS (SELECT 1 FROM unnest(phones_normalized) AS p WHERE p LIKE ${`%${q.phoneDigits}%`})`
        : Prisma.empty;
      const rows = await prisma.scoped.$queryRaw<
        Array<{ id: string; full_name: string; email: string | null; phone: string | null }>
      >`
        SELECT id, full_name, email::text AS email, phones[1] AS phone FROM customers
        WHERE workspace_id = ${workspaceOf(cls)} AND NOT is_walk_in AND status = 'ACTIVE'
          AND (full_name ILIKE ${q.like} OR email::text ILIKE ${q.like} ${phone})
        ORDER BY (lower(full_name) = lower(${q.raw})) DESC, full_name LIMIT ${limit}`;
      return rows.map((r) => ({
        id: r.id,
        type: 'CUSTOMER',
        title: r.full_name,
        subtitle: [r.phone, r.email].filter(Boolean).join(' · ') || null,
        href: `/customers/${r.id}`,
      }));
    },
  };
}

/** Leads: name, phone and interest; people without `lead:view_all` find only their own. */
export function leadSearch(prisma: PrismaService, cls: ClsService<RequestContext>): SearchProvider {
  return {
    type: 'LEAD',
    permission: 'lead:view',
    async search(user, q, limit) {
      const phone = q.phoneDigits
        ? Prisma.sql`OR phone_normalized LIKE ${`%${q.phoneDigits}%`}`
        : Prisma.empty;
      const scope = user.permissions.includes('lead:view_all')
        ? Prisma.empty
        : Prisma.sql`AND (assigned_to_id = ${user.userId} OR created_by_id = ${user.userId})`;
      const rows = await prisma.scoped.$queryRaw<
        Array<{ id: string; full_name: string; interest: string | null; phone: string | null }>
      >`
        SELECT id, full_name, interest, phone FROM leads
        WHERE workspace_id = ${workspaceOf(cls)} ${scope}
          AND (full_name ILIKE ${q.like} OR interest ILIKE ${q.like} OR email::text ILIKE ${q.like} ${phone})
        ORDER BY (lower(full_name) = lower(${q.raw})) DESC, updated_at DESC LIMIT ${limit}`;
      return rows.map((r) => ({
        id: r.id,
        type: 'LEAD',
        title: r.full_name,
        subtitle: [r.interest, r.phone].filter(Boolean).join(' · ') || null,
        href: `/leads/${r.id}`,
      }));
    },
  };
}
