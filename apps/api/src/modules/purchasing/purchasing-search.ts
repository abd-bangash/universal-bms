import { Prisma } from '@prisma/client';
import type { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { SearchProvider } from '../search/search.types';

/** Suppliers: name, contact, phone and email (Requirement 31.1). */
export function supplierSearch(
  prisma: PrismaService,
  cls: ClsService<RequestContext>,
): SearchProvider {
  return {
    type: 'SUPPLIER',
    permission: 'supplier:view',
    async search(_user, q, limit) {
      const workspaceId = cls.get('workspaceId');
      if (!workspaceId) throw new Error('No workspace in context');
      const phone = q.phoneDigits
        ? Prisma.sql`OR regexp_replace(phone, '\\D', '', 'g') LIKE ${`%${q.phoneDigits}%`}`
        : Prisma.empty;
      const rows = await prisma.scoped.$queryRaw<
        Array<{ id: string; name: string; contact_name: string | null; phone: string | null }>
      >`
        SELECT id, name, contact_name, phone FROM suppliers
        WHERE workspace_id = ${workspaceId} AND status = 'ACTIVE'
          AND (name ILIKE ${q.like} OR contact_name ILIKE ${q.like} OR email ILIKE ${q.like} ${phone})
        ORDER BY (lower(name) = lower(${q.raw})) DESC, name LIMIT ${limit}`;
      return rows.map((r) => ({
        id: r.id,
        type: 'SUPPLIER',
        title: r.name,
        subtitle: [r.contact_name, r.phone].filter(Boolean).join(' · ') || null,
        href: `/purchasing/suppliers/${r.id}`,
      }));
    },
  };
}
