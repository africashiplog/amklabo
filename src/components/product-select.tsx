import { Field } from "./forms";

export function ProductSelect({ products, name = "productId", label = "Produit", defaultValue }: {
  products: { id: string; name: string; sku: string }[]; name?: string; label?: string; defaultValue?: string | null;
}) {
  return (
    <Field name={name} label={label} as="select" defaultValue={defaultValue ?? ""} required>
      <option value="">— Choisir un produit —</option>
      {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
    </Field>
  );
}
