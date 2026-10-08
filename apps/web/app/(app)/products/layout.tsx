import type { ReactNode } from 'react';
import { ProductsNav } from './products-nav';

export default function ProductsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-6xl">
      <ProductsNav />
      {children}
    </div>
  );
}
