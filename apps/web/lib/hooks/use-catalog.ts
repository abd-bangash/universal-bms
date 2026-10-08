'use client';

import { useQuery } from '@tanstack/react-query';
import type { FieldDefinitionView, UnitOption } from '@/components/dynamic-fields/dynamic-fields';
import { api } from '../api-client';

export interface CategoryNode {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  active: boolean;
  children: CategoryNode[];
}

export interface Brand {
  id: string;
  name: string;
  active: boolean;
}

export interface TaxClass {
  id: string;
  name: string;
  rate: string;
  active: boolean;
}

export interface VariantView {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  isDefault: boolean;
  priceOverride: string | null;
  /** Present only for users who hold product:view_cost. */
  costOverride?: string | null;
  weight: string | null;
  minStockLevel: string | null;
  maxStockLevel: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  customFields: Record<string, unknown>;
}

export interface ImageView {
  id: string;
  fileId: string;
  variantId: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface ProductView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  brandId: string | null;
  type: 'STOCKABLE' | 'NON_STOCKABLE' | 'SERVICE' | 'BUNDLE';
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  madeToOrder: boolean;
  tracking: 'NONE' | 'BATCH' | 'SERIAL';
  baseUnitId: string | null;
  saleUnitId: string | null;
  purchaseUnitId: string | null;
  basePrice: string;
  /** Present only for users who hold product:view_cost. */
  costPrice?: string | null;
  taxClassId: string | null;
  tags: string[];
  aliases: string[];
  visibleInPos: boolean;
  visibleToAi: boolean;
  customFields: Record<string, unknown>;
  version: number;
  variants?: VariantView[];
  images?: ImageView[];
}

export type FieldEntityType = 'PRODUCT' | 'VARIANT';
export type CatalogFieldDefinition = FieldDefinitionView & {
  id: string;
  isVariantAxis: boolean;
};

export const categoriesKey = (all: boolean) => ['catalog', 'categories', all] as const;

export function useCategoriesQuery(includeInactive = false) {
  return useQuery({
    queryKey: categoriesKey(includeInactive),
    queryFn: ({ signal }) =>
      api.get<CategoryNode[]>('/catalog/categories', { includeInactive }, signal),
  });
}

export function useBrandsQuery(includeInactive = false) {
  return useQuery({
    queryKey: ['catalog', 'brands', includeInactive],
    queryFn: ({ signal }) => api.get<Brand[]>('/catalog/brands', { includeInactive }, signal),
  });
}

export function useFieldsQuery(entityType: FieldEntityType | string) {
  return useQuery({
    queryKey: ['fields', entityType],
    queryFn: ({ signal }) => api.get<CatalogFieldDefinition[]>('/fields', { entityType }, signal),
  });
}

export function useUnitsQuery() {
  return useQuery({
    queryKey: ['settings', 'units'],
    queryFn: ({ signal }) =>
      api.get<Array<UnitOption & { id: string }>>('/settings/units', undefined, signal),
    staleTime: 5 * 60_000,
  });
}

export function useTaxClassesQuery() {
  return useQuery({
    queryKey: ['settings', 'tax-classes'],
    queryFn: ({ signal }) => api.get<TaxClass[]>('/settings/tax-classes', undefined, signal),
    staleTime: 5 * 60_000,
  });
}

/** The tree as a flat list with a depth, for selects and indented lists. */
export function flattenCategories(
  nodes: CategoryNode[],
  depth = 0,
): Array<CategoryNode & { depth: number }> {
  return nodes.flatMap((n) => [{ ...n, depth }, ...flattenCategories(n.children, depth + 1)]);
}

/** Ids of the ancestors of a category, nearest first (for category-scoped fields). */
export function ancestorIds(nodes: CategoryNode[], id: string | null | undefined): string[] {
  if (!id) return [];
  const flat = flattenCategories(nodes);
  const parentOf = new Map(flat.map((c) => [c.id, c.parentId]));
  const out: string[] = [];
  let next = parentOf.get(id) ?? null;
  while (next && !out.includes(next)) {
    out.push(next);
    next = parentOf.get(next) ?? null;
  }
  return out;
}
