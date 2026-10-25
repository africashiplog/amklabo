import { describe, expect, it } from "vitest";
import { pool } from "@/server/db";
import { UserError } from "@/server/errors";
import { login, MAX_FAILED_PER_EMAIL, registerCustomer } from "@/server/services/accounts";
import { getSessionActor } from "@/server/session";
import { makeActor, uniqueEmail } from "./helpers";

const password = "motdepasse-solide";

describe("inscription et connexion", () => {
  it("crée un compte client particulier complet", async () => {
    const email = uniqueEmail();
    const { userId } = await registerCustomer({ fullName: "Aminata Test", email, phone: "+222 22 11 22 33", password });
    const { rows } = await pool().query(
      `SELECT u.password_hash, c.customer_type, array_agg(r.role)::text[] AS roles
         FROM users u JOIN customers c ON c.user_id = u.id JOIN user_roles r ON r.user_id = u.id
        WHERE u.id = $1 GROUP BY u.id, c.customer_type`, [userId]);
    expect(rows[0].customer_type).toBe("retail");
    expect(rows[0].roles).toEqual(["customer_retail"]);
    expect(rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(rows[0].password_hash).not.toContain(password);
  });

  it("refuse une adresse e-mail déjà utilisée (insensible à la casse)", async () => {
    const email = uniqueEmail();
    await registerCustomer({ fullName: "A Test", email, phone: "+222 22 11 22 33", password });
    await expect(registerCustomer({ fullName: "B Test", email: email.toUpperCase(), phone: "+222 22 11 22 34", password }))
      .rejects.toThrow(UserError);
  });

  it("refuse un mot de passe trop court", async () => {
    await expect(registerCustomer({ fullName: "A Test", email: uniqueEmail(), phone: "+222 22 11 22 33", password: "court" }))
      .rejects.toThrow();
  });

  it("ouvre une session valide avec le bon mot de passe", async () => {
    const email = uniqueEmail();
    await registerCustomer({ fullName: "A Test", email, phone: "+222 22 11 22 33", password });
    const { token } = await login({ email, password });
    const actor = await getSessionActor(token);
    expect(actor?.email).toBe(email);
    expect(actor?.roles).toEqual(["customer_retail"]);
    expect(await getSessionActor(token + "x")).toBeNull();
  });

  it("renvoie la même erreur générique pour e-mail inconnu et mauvais mot de passe", async () => {
    const email = uniqueEmail();
    await registerCustomer({ fullName: "A Test", email, phone: "+222 22 11 22 33", password });
    const e1 = await login({ email, password: "mauvais-mdp" }).catch((e) => e.message);
    const e2 = await login({ email: uniqueEmail(), password }).catch((e) => e.message);
    expect(e1).toBe(e2);
  });

  it("bloque après trop de tentatives échouées, même avec le bon mot de passe", async () => {
    const email = uniqueEmail();
    await registerCustomer({ fullName: "A Test", email, phone: "+222 22 11 22 33", password });
    for (let i = 0; i < MAX_FAILED_PER_EMAIL; i++) await login({ email, password: "faux" }).catch(() => {});
    await expect(login({ email, password })).rejects.toThrow(/Trop de tentatives/);
  });

  it("invalide les sessions d'un compte suspendu", async () => {
    const email = uniqueEmail();
    const { userId } = await registerCustomer({ fullName: "A Test", email, phone: "+222 22 11 22 33", password });
    const { token } = await login({ email, password });
    await pool().query("UPDATE users SET status = 'suspended' WHERE id = $1", [userId]);
    expect(await getSessionActor(token)).toBeNull();
    await expect(login({ email, password })).rejects.toThrow(/suspendu/);
  });

  it("ignore une session expirée", async () => {
    const actor = await makeActor(["admin"]);
    const { createSession } = await import("@/server/session");
    const { token } = await createSession(actor.id);
    await pool().query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1", [actor.id]);
    expect(await getSessionActor(token)).toBeNull();
  });
});
