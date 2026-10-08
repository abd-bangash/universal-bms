import { Prisma } from '@prisma/client';
import type { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { SearchProvider } from '../search/search.types';

/** Conversations: the contact's name and number; people without `conversation:view_all` find only theirs. */
export function conversationSearch(
  prisma: PrismaService,
  cls: ClsService<RequestContext>,
): SearchProvider {
  return {
    type: 'CONVERSATION',
    permission: 'conversation:view',
    async search(user, q, limit) {
      const workspaceId = cls.get('workspaceId');
      if (!workspaceId) throw new Error('No workspace in context');
      const phone = q.phoneDigits
        ? Prisma.sql`OR c.contact_phone LIKE ${`%${q.phoneDigits}%`}`
        : Prisma.empty;
      const scope = user.permissions.includes('conversation:view_all')
        ? Prisma.empty
        : Prisma.sql`AND (c.assigned_to_id = ${user.userId} OR l.assigned_to_id = ${user.userId})`;
      const rows = await prisma.scoped.$queryRaw<
        Array<{ id: string; title: string; phone: string | null; channel_type: string }>
      >`
        SELECT c.id, COALESCE(cu.full_name, l.full_name, c.contact_name, c.contact_phone, c.external_contact_id) AS title,
               c.contact_phone AS phone, c.channel_type
        FROM conversations c
        LEFT JOIN customers cu ON cu.id = c.customer_id
        LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.workspace_id = ${workspaceId} ${scope}
          AND (c.contact_name ILIKE ${q.like} OR cu.full_name ILIKE ${q.like} OR l.full_name ILIKE ${q.like} ${phone})
        ORDER BY c.last_message_at DESC NULLS LAST LIMIT ${limit}`;
      return rows.map((r) => ({
        id: r.id,
        type: 'CONVERSATION',
        title: r.title,
        subtitle: [r.channel_type, r.phone].filter(Boolean).join(' · ') || null,
        href: `/conversations?open=${r.id}`,
      }));
    },
  };
}
