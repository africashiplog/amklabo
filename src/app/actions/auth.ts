"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { formString, runAction, type ActionState } from "@/server/action";
import { clientIp, setSessionCookie } from "@/server/current";
import { UserError } from "@/server/errors";
import { login, registerCustomer } from "@/server/services/accounts";
import { deleteSession, SESSION_COOKIE } from "@/server/session";

/** N'autorise que les redirections internes (évite les redirections ouvertes). */
function safeNext(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/compte";
}

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let target = "/compte";
  const state = await runAction(async () => {
    const ip = await clientIp();
    const userAgent = (await headers()).get("user-agent");
    const res = await login({ email: formString(fd, "email"), password: formString(fd, "password") }, { ip, userAgent });
    await setSessionCookie(res.token, res.expiresAt);
    target = safeNext(formString(fd, "next"));
  });
  if (state.ok) redirect(target);
  return state;
}

export async function registerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const state = await runAction(async () => {
    const ip = await clientIp();
    const input = {
      fullName: formString(fd, "fullName"),
      email: formString(fd, "email"),
      phone: formString(fd, "phone"),
      password: formString(fd, "password"),
    };
    if (input.password !== formString(fd, "confirm")) {
      throw new UserError("Les mots de passe ne correspondent pas.", { confirm: "Ne correspond pas" });
    }
    if (formString(fd, "terms") !== "on") {
      throw new UserError("Vous devez accepter les conditions générales.", { terms: "Requis" });
    }
    await registerCustomer(input, { ip });
    const res = await login({ email: input.email, password: input.password }, { ip, userAgent: (await headers()).get("user-agent") });
    await setSessionCookie(res.token, res.expiresAt);
  });
  if (state.ok) redirect("/compte?bienvenue=1");
  return state;
}

export async function logoutAction() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  store.delete(SESSION_COOKIE);
  redirect("/");
}
