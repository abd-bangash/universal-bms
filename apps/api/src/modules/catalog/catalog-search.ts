import type { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { SearchProvider } from '../search/search.types';

/** Products: name, code, SKU, barcode and aliases; archived products are not offered. */
export function productSearch(
  prisma: PrismaService,
  cls: ClsService<RequestContext>,
): SearchProvider {
  return {
    type: 'PRODUCT',
    permission: 'product:view',
    async search(_user, q, limit) {
      const workspaceId = cls.get('workspaceId');
      if (!workspaceId) throw new Error('No workspace in context');
      const rows = await prisma.scoped.$queryRaw<
        Array<{ id: string; name: string; code: string; matched_sku: string | null }>
      >`
        SELECT p.id, p.name, p.code,
               (SELECT v.sku FROM product_variants v
                 WHERE v.product_id = p.id AND (v.sku ILIKE ${q.like} OR v.barcode ILIKE ${q.like}) LIMIT 1) AS matched_sku
        FROM products p
        WHERE p.workspace_id = ${workspaceId} AND p.status <> 'ARCHIVED'
          AND (p.name ILIKE ${q.like} OR p.code ILIKE ${q.like}
               OR EXISTS (SELECT 1 FROM unnest(p.aliases) AS a WHERE a ILIKE ${q.like})
               OR EXISTS (SELECT 1 FROM product_variants v
                           WHERE v.product_id = p.id AND (v.sku ILIKE ${q.like} OR v.barcode ILIKE ${q.like})))
        ORDER BY (lower(p.name) = lower(${q.raw}) OR lower(p.code) = lower(${q.raw})) DESC, p.name LIMIT ${limit}`;
      return rows.map((r) => ({
        id: r.id,
        type: 'PRODUCT',
        title: r.name,
        subtitle:
          r.matched_sku && r.matched_sku !== r.code ? `${r.code} · ${r.matched_sku}` : r.code,
        href: `/products/${r.id}`,
      }));
    },
  };
}
