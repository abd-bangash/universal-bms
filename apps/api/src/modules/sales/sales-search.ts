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

/** Orders: number and customer name; people without `order:view_all` find only their own. */
export function orderSearch(
  prisma: PrismaService,
  cls: ClsService<RequestContext>,
): SearchProvider {
  return {
    type: 'ORDER',
    permission: 'order:view',
    async search(user, q, limit) {
      const scope = user.permissions.includes('order:view_all')
        ? Prisma.empty
        : Prisma.sql`AND (o.assigned_to_id = ${user.userId} OR o.created_by_id = ${user.userId})`;
      const rows = await prisma.scoped.$queryRaw<
        Array<{ id: string; order_number: string; full_name: string; status: string }>
      >`
        SELECT o.id, o.order_number, c.full_name, o.status FROM orders o
        JOIN customers c ON c.id = o.customer_id
        WHERE o.workspace_id = ${workspaceOf(cls)} ${scope}
          AND (o.order_number ILIKE ${q.like} OR c.full_name ILIKE ${q.like})
        ORDER BY o.order_date DESC LIMIT ${limit}`;
      return rows.map((r) => ({
        id: r.id,
        type: 'ORDER',
        title: r.order_number,
        subtitle: `${r.full_name} · ${r.status}`,
        href: `/orders/${r.id}`,
      }));
    },
  };
}

/** Quotations: number and the name of the customer or lead they are for. */
export function quotationSearch(
  prisma: PrismaService,
  cls: ClsService<RequestContext>,
): SearchProvider {
  return {
    type: 'QUOTATION',
    permission: 'quotation:view',
    async search(_user, q, limit) {
      const rows = await prisma.scoped.$queryRaw<
        Array<{ id: string; quotation_number: string; party: string | null; status: string }>
      >`
        SELECT q.id, q.quotation_number, COALESCE(c.full_name, l.full_name) AS party, q.status::text AS status
        FROM quotations q
        LEFT JOIN customers c ON c.id = q.customer_id
        LEFT JOIN leads l ON l.id = q.lead_id
        WHERE q.workspace_id = ${workspaceOf(cls)} AND q.is_latest
          AND (q.quotation_number ILIKE ${q.like} OR c.full_name ILIKE ${q.like} OR l.full_name ILIKE ${q.like})
        ORDER BY q.created_at DESC LIMIT ${limit}`;
      return rows.map((r) => ({
        id: r.id,
        type: 'QUOTATION',
        title: r.quotation_number,
        subtitle: [r.party, r.status.toLowerCase()].filter(Boolean).join(' · '),
        href: `/quotations/${r.id}`,
      }));
    },
  };
}
