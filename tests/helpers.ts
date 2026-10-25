import { randomUUID } from "node:crypto";
import type { Actor } from "@/server/actor";
import { pool } from "@/server/db";
import type { Role } from "@/server/permissions";
import { registerCustomer } from "@/server/services/accounts";

export const uniqueEmail = (prefix = "u") => `${prefix}-${randomUUID().slice(0, 8)}@test.mr`;

/** Crée un utilisateur directement en base avec les rôles donnés. */
export async function makeActor(roles: Role[], opts: { customer?: boolean } = {}): Promise<Actor> {
  const email = uniqueEmail(roles[0] ?? "user");
  const { rows } = await pool().query<{ id: string }>(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'scrypt$invalid') RETURNING id", [email],
  );
  const id = rows[0].id;
  await pool().query("INSERT INTO profiles (user_id, full_name) VALUES ($1, $2)", [id, `Test ${roles.join("+")}`]);
  for (const r of roles) await pool().query("INSERT INTO user_roles (user_id, role) VALUES ($1, $2)", [id, r]);
  if (opts.customer) {
    await pool().query("INSERT INTO customers (user_id, full_name, email) VALUES ($1, 'Client test', $2)", [id, email]);
  }
  return { id, email, fullName: `Test ${roles.join("+")}`, roles };
}

export async function makeCustomer(): Promise<Actor> {
  const email = uniqueEmail("client");
  const { userId } = await registerCustomer({ fullName: "Client Test", email, phone: "+222 22 00 00 00", password: "motdepasse-solide" });
  return { id: userId, email, fullName: "Client Test", roles: ["customer_retail"] };
}

export async function firstCategoryId(): Promise<string> {
  const { rows } = await pool().query<{ id: string }>("SELECT id FROM categories ORDER BY sort_order LIMIT 1");
  return rows[0].id;
}

export const baseProduct = (categoryId: string | null, over: Record<string, unknown> = {}) => ({
  name: "Produit test " + randomUUID().slice(0, 6),
  sku: "T-" + randomUUID().slice(0, 8),
  barcode: "",
  description: "",
  categoryId,
  brand: "",
  manufacturer: "",
  saleUnit: "box" as const,
  unitsPerSaleUnit: "100",
  retailPrice: "1250,50",
  minOrderQty: "1",
  stockAlertThreshold: "5",
  trackLots: true,
  isFeatured: false,
  status: "published" as const,
  specs: [],
  ...over,
});
