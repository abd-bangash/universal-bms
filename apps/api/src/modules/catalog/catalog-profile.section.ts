import type { IndustryProfileDefinition } from '@bms/validators';
import type { Tx } from '../tenants/registries';

/**
 * The profile's `categories` section: top-level categories with their sub-categories. Applying a
 * profile again never duplicates or removes anything (categories a user created stay).
 */
export async function applyProfileCategories(
  tx: Tx,
  workspaceId: string,
  items: unknown,
): Promise<void> {
  const categories = (items ?? []) as IndustryProfileDefinition['categories'];
  const ensure = async (name: string, parentId: string | null, sortOrder: number) => {
    const found = await tx.category.findFirst({
      where: { workspaceId, parentId, name: { equals: name, mode: 'insensitive' } },
    });
    return found ?? tx.category.create({ data: { workspaceId, parentId, name, sortOrder } });
  };
  for (const [index, root] of categories.entries()) {
    const parent = await ensure(root.name, null, index);
    for (const [childIndex, child] of root.children.entries()) {
      await ensure(child, parent.id, childIndex);
    }
  }
}
