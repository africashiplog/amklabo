import { describe, expect, it } from "vitest";
import { pool } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { login } from "@/server/services/accounts";
import { reviewBusinessAccount, submitBusinessRequest } from "@/server/services/business";
import {
  addCustomerNote, adminGetCustomer, anonymizeCustomer, createCustomer, deleteCustomer, setCustomerStatus, updateCustomer,
} from "@/server/services/customers";
import { saveMyAddress } from "@/server/services/customer-account";
import { createSession, getSessionActor } from "@/server/session";
import { makeActor, makeCustomer } from "./helpers";

const customerIdOf = async (userId: string) =>
  (await pool().query("SELECT id FROM customers WHERE user_id = $1", [userId])).rows[0].id as string;

describe("gestion des clients", () => {
  it("ajout manuel et modification par un gestionnaire des commandes", async () => {
    const om = await makeActor(["order_manager"]);
    const id = await createCustomer(om, { fullName: "Clinique Manuelle", phone: "+222 45 00 00 00", customerType: "business" });
    await updateCustomer(om, id, { fullName: "Clinique Manuelle SA", phone: "+222 45 00 00 01", customerType: "business" });
    expect((await adminGetCustomer(om, id))!.customer.full_name).toBe("Clinique Manuelle SA");
  });

  it("le comptable consulte mais ne modifie pas ; le client ne voit rien", async () => {
    const c = await makeCustomer();
    const id = await customerIdOf(c.id);
    const acc = await makeActor(["accountant"]);
    expect(await adminGetCustomer(acc, id)).not.toBeNull();
    await expect(updateCustomer(acc, id, { fullName: "X", phone: "+222 22 00 00 00", customerType: "retail" })).rejects.toThrow(ForbiddenError);
    await expect(adminGetCustomer(c, id)).rejects.toThrow(ForbiddenError);
  });

  it("notes internes en ajout seul, invisibles côté client", async () => {
    const om = await makeActor(["order_manager"]);
    const c = await makeCustomer();
    const id = await customerIdOf(c.id);
    await addCustomerNote(om, id, "Préfère être livré le matin.");
    expect((await adminGetCustomer(om, id))!.notes[0].body).toBe("Préfère être livré le matin.");
    await expect(pool().query("UPDATE customer_notes SET body = 'x' WHERE customer_id = $1", [id])).rejects.toThrow(/permission denied/);
  });

  it("suspension : sessions fermées et connexion refusée ; réactivation possible", async () => {
    const om = await makeActor(["order_manager"]);
    const c = await makeCustomer();
    const id = await customerIdOf(c.id);
    const { token } = await createSession(c.id);
    await setCustomerStatus(om, id, "suspended");
    expect(await getSessionActor(token)).toBeNull();
    await expect(login({ email: c.email, password: "motdepasse-solide" })).rejects.toThrow(/suspendu/);
    await setCustomerStatus(om, id, "active");
    await login({ email: c.email, password: "motdepasse-solide" });
  });

  it("suppression : réservée à l'administrateur, client archivé et sans historique", async () => {
    const admin = await makeActor(["admin"]);
    const om = await makeActor(["order_manager"]);
    const c = await makeCustomer();
    const id = await customerIdOf(c.id);
    await expect(deleteCustomer(om, id)).rejects.toThrow(ForbiddenError);
    await expect(deleteCustomer(admin, id)).rejects.toThrow(/Archivez/);
    await setCustomerStatus(admin, id, "archived");
    await deleteCustomer(admin, id);
    expect((await pool().query("SELECT 1 FROM users WHERE id = $1", [c.id])).rowCount).toBe(0);
    const log = await pool().query("SELECT after_data, before_data FROM audit_logs WHERE entity_id = $1 AND action = 'customer.delete'", [id]);
    expect(JSON.stringify(log.rows[0])).not.toContain(c.email);
  });

  it("client avec historique professionnel : suppression refusée, anonymisation possible", async () => {
    const admin = await makeActor(["admin"]);
    const c = await makeCustomer();
    const id = await customerIdOf(c.id);
    await saveMyAddress(c, null, { label: "Bureau", recipient: "Pharmacie Y", phone: "+222 22 00 00 09", city: "Nouakchott", line1: "Rue 1", zoneId: null, isDefault: true });
    await submitBusinessRequest(c, { establishmentName: "Pharmacie Y", activity: "pharmacy", contactName: "Mme Y", phone: "+222 22 00 00 09", addressLine: "Rue 1", city: "Nouakchott" });
    const b = await pool().query("SELECT id FROM business_accounts WHERE customer_id = $1", [id]);
    await reviewBusinessAccount(admin, b.rows[0].id, "approve", null);
    await setCustomerStatus(admin, id, "archived");
    await expect(deleteCustomer(admin, id)).rejects.toThrow(/anonymisation/);
    await anonymizeCustomer(admin, id);
    const detail = (await adminGetCustomer(admin, id))!;
    expect(detail.customer.email).toBeNull();
    expect(detail.customer.full_name).toMatch(/^Client anonymisé/);
    expect(detail.addresses).toHaveLength(0);
    await expect(login({ email: c.email, password: "motdepasse-solide" })).rejects.toThrow();
    await expect(anonymizeCustomer(admin, id)).rejects.toThrow(/déjà/);
  });
});
