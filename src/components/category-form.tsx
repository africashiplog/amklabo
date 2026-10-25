import { ActionForm, Checkbox, Field, SubmitButton } from "./forms";
import type { Category } from "@/server/services/catalog";
import { saveCategoryAction } from "@/app/admin/actions";

export function CategoryForm({ category, parents }: { category?: Category; parents: Category[] }) {
  return (
    <ActionForm action={saveCategoryAction} resetOnSuccess={!category}>
      {category && <input type="hidden" name="id" value={category.id} />}
      <Field name="name" label="Nom" defaultValue={category?.name} required />
      <Field name="parentId" label="Catégorie parente" as="select" defaultValue={category?.parent_id ?? ""}>
        <option value="">— Aucune (catégorie principale) —</option>
        {parents.filter((p) => !p.parent_id && p.id !== category?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Field>
      <Field name="description" label="Description" as="textarea" rows={3} defaultValue={category?.description ?? ""} />
      <Checkbox name="isActive" label="Active (visible sur le site)" defaultChecked={category?.is_active ?? true} />
      <SubmitButton>{category ? "Enregistrer" : "Créer la catégorie"}</SubmitButton>
    </ActionForm>
  );
}
