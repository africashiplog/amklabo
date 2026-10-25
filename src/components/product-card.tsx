import Link from "next/link";
import { formatMRU } from "@/lib/money";
import { t } from "@/i18n/fr";
import type { ProductRow } from "@/server/services/catalog";
import { mediaUrl } from "@/server/storage";
import { Badge } from "./ui";

export function ProductImagePlaceholder({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center bg-gradient-to-br from-brand-50 to-leaf-50 text-brand-200 ${className}`} aria-hidden>
      <svg viewBox="0 0 24 24" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" />
        <path d="M7 15h10" />
      </svg>
    </div>
  );
}

export function unitLabel(p: Pick<ProductRow, "sale_unit" | "units_per_sale_unit">) {
  const unit = t.saleUnit[p.sale_unit].toLowerCase();
  return p.units_per_sale_unit > 1 ? `${unit} de ${p.units_per_sale_unit}` : unit;
}

export function ProductCard({ product }: { product: ProductRow }) {
  return (
    <Link href={`/produits/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-brand-200 hover:shadow-md">
      <div className="aspect-square overflow-hidden bg-white">
        {product.cover_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(product.cover_path)} alt={product.name} loading="lazy"
            className="h-full w-full object-contain p-3 transition group-hover:scale-[1.03]" />
        ) : (
          <ProductImagePlaceholder className="h-full w-full" />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 border-t border-slate-100 p-4">
        {product.category_name && <p className="text-xs font-medium text-leaf-700">{product.category_name}</p>}
        <h3 className="line-clamp-2 font-semibold text-slate-900 group-hover:text-brand-700">{product.name}</h3>
        {product.brand && <p className="text-xs text-slate-500">{product.brand}</p>}
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <p>
            <span className="text-lg font-bold text-brand-800">{formatMRU(product.retail_price_minor)}</span>
            <span className="ms-1 text-xs text-slate-500">/ {unitLabel(product)}</span>
          </p>
          {product.status === "unavailable" && <Badge tone="amber">Indisponible</Badge>}
        </div>
      </div>
    </Link>
  );
}
