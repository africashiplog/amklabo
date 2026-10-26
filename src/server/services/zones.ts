import { z } from "../validation";
import { parseMRU } from "@/lib/money";
import { assertCan, type Actor } from "../actor";
import { audit } from "../audit";
import { pgCode, query, queryOne, tx } from "../db";
import { UserError } from "../errors";

export type DeliveryZone = {
  id: string;
  name: string;
  city: string;
  fee_minor: number;
  free_shipping_threshold_minor: number | null;
  is_active: boolean;
  sort_order: number;
  fee_mode: "fixed" | "manual";
};

export async function listActiveZones() {
  return query<DeliveryZone>("SELECT * FROM delivery_zones WHERE is_active ORDER BY sort_order, name");
}

export async function adminListZones(actor: Actor | null) {
  assertCan(actor, "settings.manage");
  return query<DeliveryZone>("SELECT * FROM delivery_zones ORDER BY sort_order, name");
}

const money = (required: boolean) =>
  z.string().transform((v, ctx) => {
    if (!required && v.trim() === "") return null;
    const m = parseMRU(v);
    if (m === null) {
      ctx.addIssue({ code: "custom", message: "Montant invalide" });
      return z.NEVER;
    }
    return m;
  });

export const zoneSchema = z.object({
  name: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  // Frais manuels : fixés par l'équipe pour chaque commande (quantité, adresse).
  feeMode: z.enum(["fixed", "manual"]).default("fixed"),
  fee: money(false),
  freeThreshold: money(false),
  isActive: z.boolean(),
}).superRefine((d, ctx) => {
  if (d.feeMode === "fixed" && d.fee === null) ctx.addIssue({ code: "custom", path: ["fee"], message: "Montant requis pour des frais fixes" });
});

export async function saveZone(actor: Actor | null, id: string | null, input: z.input<typeof zoneSchema>) {
  assertCan(actor, "settings.manage");
  const d = zoneSchema.parse(input);
  try {
    await tx(async (db) => {
      if (id) {
        const before = await queryOne("SELECT * FROM delivery_zones WHERE id = $1 FOR UPDATE", [id], db);
        if (!before) throw new UserError("Zone introuvable.");
        const after = await queryOne(
          `UPDATE delivery_zones SET name=$2, city=$3, fee_minor=$4, free_shipping_threshold_minor=$5, is_active=$6, fee_mode=$7
            WHERE id=$1 RETURNING *`,
          [id, d.name, d.city, d.fee ?? 0, d.freeThreshold, d.isActive, d.feeMode],
          db,
        );
        await audit(actor, "delivery_zone.update", "delivery_zone", id, { before, after }, db);
      } else {
        const after = await queryOne<{ id: string }>(
          `INSERT INTO delivery_zones (name, city, fee_minor, free_shipping_threshold_minor, is_active, fee_mode, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6, coalesce((SELECT max(sort_order)+1 FROM delivery_zones),0)) RETURNING *`,
          [d.name, d.city, d.fee ?? 0, d.freeThreshold, d.isActive, d.feeMode],
          db,
        );
        await audit(actor, "delivery_zone.create", "delivery_zone", after!.id, { after }, db);
      }
    });
  } catch (err) {
    if (pgCode(err) === "23505") throw new UserError("Une zone porte déjà ce nom.", { name: "Nom déjà utilisé" });
    throw err;
  }
}
