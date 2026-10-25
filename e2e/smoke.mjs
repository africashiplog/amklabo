// Parcours de bout en bout dans Chromium contre un serveur lancé (BASE_URL).
// Usage : BASE_URL=http://localhost:3100 ADMIN_EMAIL=… ADMIN_PASSWORD=… node e2e/smoke.mjs
import { createRequire } from "node:module";
// Playwright préinstallé globalement (require suit NODE_PATH, contrairement à import).
const { chromium } = createRequire(import.meta.url)("playwright");
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const ADMIN = { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD };
const shots = path.resolve("e2e/screenshots");
fs.mkdirSync(shots, { recursive: true });
const id = Date.now().toString(36);
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(["✓", name]);
    console.log("✓", name);
  } catch (e) {
    results.push(["✗", name]);
    console.error("✗", name, "\n ", e.message.split("\n").slice(0, 4).join("\n  "));
    process.exitCode = 1;
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

async function login(p, email, password) {
  await p.goto(`${BASE}/connexion`);
  await p.getByLabel("Adresse e-mail").fill(email);
  await p.getByLabel("Mot de passe").fill(password);
  await p.getByRole("button", { name: "Se connecter" }).click();
  await p.waitForURL(/\/compte|\/admin/);
}

await step("Accueil : logo officiel chargé et catégories initiales affichées", async () => {
  await page.goto(BASE);
  const logo = page.locator("header img").first();
  assert.equal(await logo.getAttribute("alt"), "AMKLABO");
  assert.ok(await logo.evaluate((img) => img.complete && img.naturalWidth > 0), "logo non chargé");
  await page.getByRole("link", { name: /Tubes de prélèvement sanguin/ }).first().waitFor();
});

await step("Accès anonyme à /admin redirigé vers la connexion", async () => {
  await page.goto(`${BASE}/admin`);
  assert.match(page.url(), /\/connexion\?next=/);
});

const customer = { email: `client-${id}@test.mr`, password: "motdepasse-e2e-1" };
await step("Inscription d'un client particulier", async () => {
  await page.goto(`${BASE}/inscription`);
  await page.getByLabel("Nom complet").fill("Client E2E");
  await page.getByLabel("Adresse e-mail").fill(customer.email);
  await page.getByLabel("Téléphone").fill("+222 22 33 44 55");
  await page.getByLabel(/^Mot de passe/).fill(customer.password);
  await page.getByLabel("Confirmer le mot de passe").fill(customer.password);
  await page.getByLabel(/J'accepte/).check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL(/\/compte\?bienvenue=1/);
  await page.getByText("Votre compte a été créé").waitFor();
});

await step("Validation : mots de passe différents refusés à l'inscription", async () => {
  const p2 = await browser.newPage();
  await p2.goto(`${BASE}/inscription`);
  await p2.getByLabel("Nom complet").fill("X Test");
  await p2.getByLabel("Adresse e-mail").fill(`x-${id}@test.mr`);
  await p2.getByLabel("Téléphone").fill("+222 22 33 44 55");
  await p2.getByLabel(/^Mot de passe/).fill("motdepasse-aaa");
  await p2.getByLabel("Confirmer le mot de passe").fill("motdepasse-bbb");
  await p2.getByLabel(/J'accepte/).check();
  await p2.getByRole("button", { name: "Créer mon compte" }).click();
  await p2.getByText("Les mots de passe ne correspondent pas").waitFor();
  await p2.close();
});

await step("Ajout d'une adresse de livraison", async () => {
  await page.getByLabel("Destinataire").fill("Client E2E");
  await page.locator("#adresses").getByLabel("Téléphone").fill("+222 22 33 44 55");
  await page.getByRole("textbox", { name: /^Adresse/ }).fill("Îlot C, maison 7");
  await page.getByRole("button", { name: "Ajouter l'adresse" }).click();
  await page.getByText("Îlot C, maison 7").first().waitFor();
});

await step("Un client n'a pas accès à l'administration", async () => {
  await page.goto(`${BASE}/admin/produits`);
  assert.match(page.url(), /\/acces-refuse/);
  await page.getByRole("heading", { name: "Accès refusé" }).waitFor();
});

const admin = await browser.newContext();
const ap = await admin.newPage();
ap.on("pageerror", (e) => errors.push(e.message));
const sku = `E2E-${id}`.toUpperCase();

await step("Connexion administrateur et tableau de bord", async () => {
  await login(ap, ADMIN.email, ADMIN.password);
  await ap.goto(`${BASE}/admin`);
  await ap.getByRole("heading", { name: "Tableau de bord" }).waitFor();
  await ap.getByText("Produits publiés").waitFor();
});

await step("Création d'une catégorie", async () => {
  await ap.goto(`${BASE}/admin/categories`);
  await ap.getByLabel("Nom", { exact: true }).fill(`Catégorie ${id}`);
  await ap.getByRole("button", { name: "Créer la catégorie" }).click();
  await ap.getByRole("link", { name: `Catégorie ${id}` }).waitFor();
});

await step("Création d'un produit (prix, unité, caractéristique) et publication", async () => {
  await ap.goto(`${BASE}/admin/produits/nouveau`);
  await ap.getByLabel("Nom du produit").fill(`Tube EDTA E2E ${id}`);
  await ap.getByLabel("Référence (SKU)").fill(sku);
  await ap.getByLabel("Catégorie").selectOption({ label: `Catégorie ${id}` });
  await ap.getByLabel("Prix public (MRU)").fill("1250,50");
  await ap.getByLabel("Unité de vente", { exact: true }).selectOption("box");
  await ap.getByLabel("Unités par unité de vente").fill("100");
  await ap.getByRole("button", { name: "+ Ajouter une caractéristique" }).click();
  await ap.getByLabel("Caractéristique 1").fill("Volume");
  await ap.getByLabel("Valeur 1").fill("4 ml");
  await ap.getByLabel("Statut").selectOption("published");
  await ap.getByRole("button", { name: "Créer le produit" }).click();
  await ap.waitForURL(/\/admin\/produits\/[0-9a-f-]+\?cree=1/);
});

await step("Validation serveur : prix invalide refusé", async () => {
  await ap.getByLabel("Prix public (MRU)").fill("12,345");
  await ap.getByRole("button", { name: "Enregistrer le produit" }).click();
  await ap.getByText("Prix invalide").waitFor();
  await ap.reload();
});

await step("Téléversement d'une image produit (et refus d'un faux fichier image)", async () => {
  const fake = path.resolve("e2e/screenshots/fake.png");
  fs.writeFileSync(fake, "<svg onload=alert(1)>");
  await ap.getByLabel(/Ajouter une image/).setInputFiles(fake);
  await ap.getByRole("button", { name: "Téléverser" }).click();
  await ap.getByText("Format non pris en charge").waitFor();
  await ap.getByLabel(/Ajouter une image/).setInputFiles(path.resolve("public/brand/icon.png"));
  await ap.getByRole("button", { name: "Téléverser" }).click();
  await ap.getByText("Image principale").waitFor();
});

await step("Produit visible sur le site : recherche, prix et caractéristiques", async () => {
  await page.goto(`${BASE}/catalogue?q=${sku}`);
  await page.getByText("1 produit").waitFor();
  await page.getByRole("link", { name: new RegExp(`Tube EDTA E2E ${id}`) }).click();
  await page.waitForURL(/\/produits\//);
  await page.getByRole("heading", { level: 1, name: `Tube EDTA E2E ${id}` }).waitFor();
  const text = await page.locator("main").innerText();
  assert.match(text, /1 250,50 MRU/);
  assert.match(text, /par boîte de 100/);
  assert.match(text, /Volume\s+4 ml/);
  assert.ok(await page.locator("main img").first().evaluate((i) => i.naturalWidth > 0));
});

await step("Archivage : le produit disparaît du site public", async () => {
  await ap.getByLabel("Statut").selectOption("archived");
  await ap.getByRole("button", { name: "Enregistrer le produit" }).click();
  await ap.getByText("Produit enregistré.").waitFor();
  const res = await page.goto(page.url());
  assert.equal(res.status(), 404);
});

await step("Suppression confirmée d'un produit archivé", async () => {
  await ap.reload();
  await ap.getByRole("button", { name: "Supprimer le produit" }).click();
  await ap.getByRole("dialog").getByText(sku).waitFor();
  await ap.getByRole("button", { name: "Supprimer définitivement" }).click();
  await ap.waitForURL(/\/admin\/produits\?supprime=1/);
});

await step("Formulaire de contact enregistré et visible en administration", async () => {
  await page.goto(`${BASE}/contact?sujet=Demande%20E2E%20${id}`);
  await page.getByLabel("Message").fill("Bonjour, je souhaite un devis pour 500 boîtes.");
  await page.getByRole("button", { name: "Envoyer le message" }).click();
  await page.getByText("Votre message a bien été enregistré").waitFor();
  await ap.goto(`${BASE}/admin/messages`);
  await ap.getByText(`Demande E2E ${id}`).waitFor();
});

await step("Paramètres : le téléphone saisi apparaît sur le site", async () => {
  await ap.goto(`${BASE}/admin/parametres`);
  await ap.getByLabel("Téléphone").fill("+222 00 00 00 00");
  await ap.getByRole("button", { name: "Enregistrer les paramètres" }).click();
  await ap.getByText("Paramètres enregistrés.").waitFor();
  await page.goto(BASE);
  await page.locator("footer").getByText("+222 00 00 00 00").waitFor();
});

await step("Journal d'audit : changements tracés", async () => {
  await ap.goto(`${BASE}/admin/journal?action=product.`);
  await ap.getByText("product.delete").first().waitFor();
  await ap.getByText("product.status_change").first().waitFor();
});

await step("Responsive : pas de défilement horizontal (375 / 768 / 1280 px)", async () => {
  for (const [w, h] of [[375, 812], [768, 1024], [1280, 900]]) {
    for (const [name, p, url] of [["accueil", page, "/"], ["catalogue", page, "/catalogue"], ["admin", ap, "/admin/produits"]]) {
      await p.setViewportSize({ width: w, height: h });
      await p.goto(BASE + url);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `${name} @${w}px déborde de ${overflow}px`);
      await p.screenshot({ path: `${shots}/${name}-${w}.png`, fullPage: name === "accueil" });
    }
  }
});

await step("Aucune erreur JavaScript côté navigateur", async () => {
  assert.deepEqual(errors, []);
});

await browser.close();
console.log(`\n${results.filter((r) => r[0] === "✓").length}/${results.length} étapes réussies`);
