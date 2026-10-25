import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { pool } from "@/server/db";
import { ForbiddenError, UserError } from "@/server/errors";
import { deleteMyAddress, listMyAddresses, saveMyAddress } from "@/server/services/customer-account";
import { setStaffRoles, setUserStatus, createStaffUser } from "@/server/services/users";
import { createSession, getSessionActor } from "@/server/session";
import { makeActor, makeCustomer, uniqueEmail } from "./helpers";

const address = {
  label: "Domicile", recipient: "Client A", phone: "+222 22 00 00 01", city: "Nouakchott",
  district: "Tevragh Zeina", line1: "Îlot K, maison 12", landmark: "", zoneId: null, isDefault: true,
};

describe("isolation des données clients", () => {
  it("un client ne voit, ne modifie et ne supprime que ses propres adresses", async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    await saveMyAddress(a, null, address);
    const [addrA] = await listMyAddresses(a);
    expect(addrA.recipient).toBe("Client A");
    expect(await listMyAddresses(b)).toHaveLength(0);

    await expect(saveMyAddress(b, addrA.id, { ...address, recipient: "Pirate" })).rejects.toThrow(UserError);
    await expect(deleteMyAddress(b, addrA.id)).rejects.toThrow(UserError);
    const [still] = await listMyAddresses(a);
    expect(still.recipient).toBe("Client A");
  });

  it("refuse une zone de livraison inactive", async () => {
    const a = await makeCustomer();
    const { rows } = await pool().query("SELECT id FROM delivery_zones WHERE NOT is_active LIMIT 1");
    await expect(saveMyAddress(a, null, { ...address, zoneId: rows[0].id })).rejects.toThrow(/Zone/);
  });
});

describe("journal d'audit immuable", () => {
  it("le rôle applicatif ne peut ni modifier ni supprimer les entrées", async () => {
    await pool().query("INSERT INTO audit_logs (action, entity_type) VALUES ('test.entry', 'test')");
    await expect(pool().query("UPDATE audit_logs SET action = 'falsifié'")).rejects.toThrow(/permission denied/);
    await expect(pool().query("DELETE FROM audit_logs")).rejects.toThrow(/permission denied/);
  });

  it("même le propriétaire du schéma est bloqué par le déclencheur", async () => {
    const owner = new Client({ connectionString: process.env.DATABASE_OWNER_URL });
    await owner.connect();
    try {
      await expect(owner.query("DELETE FROM audit_logs")).rejects.toThrow(/lecture seule/);
      await expect(owner.query("TRUNCATE audit_logs")).rejects.toThrow(/lecture seule/);
    } finally {
      await owner.end();
    }
  });

  it("le rôle applicatif ne peut pas modifier le schéma", async () => {
    await expect(pool().query("DROP TABLE products")).rejects.toThrow();
    await expect(pool().query("ALTER TABLE users ADD COLUMN x int")).rejects.toThrow();
  });
});

describe("gestion des rôles et des comptes", () => {
  it("seul un administrateur peut attribuer des rôles", async () => {
    const target = await makeCustomer();
    await expect(setStaffRoles(await makeActor(["stock_manager"]), target.id, ["admin"])).rejects.toThrow(ForbiddenError);
    await expect(setStaffRoles(await makeActor(["order_manager", "accountant"]), target.id, ["admin"])).rejects.toThrow(ForbiddenError);
  });

  it("conserve les rôles clients lors d'une modification des rôles du personnel", async () => {
    const admin = await makeActor(["admin"]);
    const target = await makeCustomer();
    await setStaffRoles(admin, target.id, ["delivery"]);
    const actor = await getSessionActor((await createSession(target.id)).token);
    expect(actor?.roles.sort()).toEqual(["customer_retail", "delivery"]);
  });

  it("refuse les rôles inconnus", async () => {
    await expect(setStaffRoles(await makeActor(["admin"]), (await makeCustomer()).id, ["superuser"])).rejects.toThrow(UserError);
  });

  it("un administrateur ne peut pas retirer son propre rôle ni suspendre son compte", async () => {
    const admin = await makeActor(["admin"]);
    await expect(setStaffRoles(admin, admin.id, ["stock_manager"])).rejects.toThrow(/propre rôle/);
    await expect(setUserStatus(admin, admin.id, "suspended")).rejects.toThrow(/propre compte/);
  });

  it("la suspension ferme immédiatement les sessions", async () => {
    const admin = await makeActor(["admin"]);
    const target = await makeCustomer();
    const { token } = await createSession(target.id);
    expect(await getSessionActor(token)).not.toBeNull();
    await setUserStatus(admin, target.id, "suspended");
    expect(await getSessionActor(token)).toBeNull();
    const { rows } = await pool().query("SELECT action FROM audit_logs WHERE entity_id = $1 AND action = 'user.suspend'", [target.id]);
    expect(rows).toHaveLength(1);
  });

  it("crée un compte du personnel avec un mot de passe temporaire haché", async () => {
    const admin = await makeActor(["admin"]);
    const email = uniqueEmail("staff");
    const { userId, tempPassword } = await createStaffUser(admin, { fullName: "Magasinier", email, roles: ["stock_manager"] });
    const { rows } = await pool().query("SELECT password_hash FROM users WHERE id = $1", [userId]);
    expect(rows[0].password_hash).not.toContain(tempPassword);
    await expect(createStaffUser(admin, { fullName: "X", email: uniqueEmail(), roles: ["customer_retail"] })).rejects.toThrow();
  });
});
