import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { formatMRU, minorToInput } from "@/lib/money";
import type { Invoice, InvoiceItem, SellerSnapshot } from "./services/invoices";
import { paymentState, PAYMENT_LABEL } from "./services/invoices";
import { resolveStoragePath } from "./storage";

const BLUE = "#034581";
const GREEN = "#448833";
const GREY = "#64748b";

// Les polices standard PDF utilisent l'encodage WinAnsi : on remplace les
// quelques caractères typographiques qui n'y figurent pas.
const clean = (s: string | null | undefined) =>
  (s ?? "").replace(/[  ]/g, " ").replace(/−/g, "-").replace(/[‘’]/g, "'").replace(/[^\x00-\xff€…–—]/g, "?");
const money = (m: number) => clean(formatMRU(m));
const date = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

function logoFile(seller: SellerSnapshot | null): string {
  const custom = seller?.logo_path ? resolveStoragePath(seller.logo_path) : null;
  if (custom && /\.(png|jpg)$/.test(custom) && fs.existsSync(custom)) return custom;
  return path.join(process.cwd(), "public", "brand", "logo.png");
}

/** Génère le PDF d'une facture ou d'un avoir à partir des données figées. */
export function renderInvoicePdf(inv: Invoice, items: InvoiceItem[], fallbackSeller: SellerSnapshot): Promise<Buffer> {
  const seller = inv.seller ?? fallbackSeller;
  const isCredit = inv.kind === "credit_note";
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: {
    Title: `${isCredit ? "Avoir" : "Facture"} ${inv.number ?? "brouillon"}`, Author: clean(seller.store_name),
  } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const left = 48;
  const right = doc.page.width - 48;
  const width = right - left;

  // En-tête : logo officiel (proportions conservées) et coordonnées du vendeur.
  doc.image(logoFile(seller), left, 40, { fit: [150, 72] });
  const sellerLines = [
    seller.legal_name || seller.store_name,
    seller.address_line, [seller.city, seller.country].filter(Boolean).join(", "),
    seller.phone && `Tél. : ${seller.phone}`, seller.email,
    seller.tax_id && `NIF : ${seller.tax_id}`, seller.trade_register && `RC : ${seller.trade_register}`,
  ].filter(Boolean) as string[];
  doc.font("Helvetica-Bold").fontSize(10).fillColor(BLUE).text(clean(sellerLines[0]), left + 250, 44, { width: width - 250, align: "right" });
  doc.font("Helvetica").fontSize(8.5).fillColor(GREY);
  for (const l of sellerLines.slice(1)) doc.text(clean(l), { width: width - 250, align: "right" });

  // Titre
  let y = 132;
  doc.font("Helvetica-Bold").fontSize(20).fillColor(isCredit ? GREEN : BLUE)
    .text(isCredit ? "AVOIR" : "FACTURE", left, y);
  doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
  const meta: [string, string][] = [
    ["Numéro", inv.number ?? "BROUILLON — sans valeur"],
    ["Date", date(inv.issue_date)],
  ];
  if (inv.due_date) meta.push(["Échéance", date(inv.due_date)]);
  if (inv.order_number) meta.push(["Commande", inv.order_number]);
  if (isCredit && inv.credited_number) meta.push(["Avoir sur facture", inv.credited_number]);
  let my = y + 30;
  for (const [k, v] of meta) {
    doc.fillColor(GREY).text(clean(k), left, my, { width: 110 });
    doc.fillColor("#0f172a").font("Helvetica-Bold").text(clean(v), left + 110, my, { width: 160 });
    doc.font("Helvetica");
    my += 15;
  }

  // Client
  doc.roundedRect(left + 290, y, width - 290, 104, 6).strokeColor("#cbd5e1").stroke();
  doc.fontSize(8).fillColor(GREY).text("FACTURÉ À", left + 302, y + 10);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(clean(inv.buyer_business || inv.buyer_name), left + 302, y + 24, { width: width - 314 });
  doc.font("Helvetica").fontSize(9);
  for (const l of [inv.buyer_business ? inv.buyer_name : null, inv.buyer_address, inv.buyer_phone, inv.buyer_email,
    inv.buyer_professional_id && `Identifiant professionnel : ${inv.buyer_professional_id}`].filter(Boolean)) {
    doc.text(clean(l as string), { width: width - 314 });
  }

  // Lignes
  y = Math.max(my, y + 104) + 24;
  const cols = [
    { k: "Réf.", w: 70, a: "left" }, { k: "Désignation", w: 175, a: "left" }, { k: "Unité", w: 65, a: "left" },
    { k: "Qté", w: 40, a: "right" }, { k: "P.U.", w: 75, a: "right" }, { k: "Total", w: width - 425, a: "right" },
  ] as const;
  const header = () => {
    doc.rect(left, y, width, 20).fill(BLUE);
    let x = left;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff");
    for (const c of cols) { doc.text(clean(c.k), x + 4, y + 6, { width: c.w - 8, align: c.a }); x += c.w; }
    y += 24;
    doc.font("Helvetica").fontSize(8.5).fillColor("#0f172a");
  };
  header();
  for (const it of items) {
    const cells = [it.sku ?? "", it.description, it.unit_label, String(it.quantity), money(it.unit_price_minor), money(it.line_total_minor)];
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(clean(c), { width: cols[i].w - 8 }))) + 6;
    if (y + h > doc.page.height - 200) { doc.addPage(); y = 48; header(); }
    let x = left;
    cells.forEach((c, i) => { doc.text(clean(c), x + 4, y, { width: cols[i].w - 8, align: cols[i].a }); x += cols[i].w; });
    y += h;
    doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor("#e2e8f0").lineWidth(0.5).stroke();
  }

  // Totaux
  if (y > doc.page.height - 230) { doc.addPage(); y = 48; }
  y += 8;
  const totals: [string, string, boolean?][] = [["Sous-total", money(inv.subtotal_minor)]];
  if (inv.discount_minor > 0) totals.push(["dont remises accordées", money(inv.discount_minor)]);
  if (!isCredit) totals.push(["Livraison", money(inv.shipping_minor)]);
  totals.push([isCredit ? "Total de l'avoir" : "Total à payer", money(inv.total_minor), true]);
  if (inv.tax_rate_bp > 0) totals.push([`dont ${seller.tax_label} ${minorToInput(inv.tax_rate_bp)} %`, money(inv.tax_included_minor)]);
  if (!isCredit) {
    if (inv.credited_total_minor > 0) totals.push(["Avoirs émis", `- ${money(inv.credited_total_minor)}`]);
    totals.push(["Montant réglé", money(inv.amount_paid_minor)]);
    totals.push(["Reste à payer", money(Math.max(inv.total_minor - inv.credited_total_minor - inv.amount_paid_minor, 0)), true]);
  }
  for (const [k, v, strong] of totals) {
    doc.font(strong ? "Helvetica-Bold" : "Helvetica").fontSize(strong ? 10.5 : 9).fillColor(strong ? BLUE : "#0f172a");
    doc.text(clean(k), right - 270, y, { width: 150, align: "right" });
    doc.text(clean(v), right - 115, y, { width: 115, align: "right" });
    y += strong ? 18 : 14;
  }
  if (!isCredit && inv.status === "issued") {
    const state = paymentState(inv);
    doc.font("Helvetica").fontSize(9).fillColor(GREY)
      .text(clean(`Statut du règlement : ${PAYMENT_LABEL[state]}${inv.payment_method ? ` — ${inv.payment_method}` : ""}`), left, y + 6);
    y += 20;
  }
  if (inv.notes) { doc.fontSize(9).fillColor("#0f172a").text(clean(inv.notes), left, y + 10, { width }); }

  // Mentions
  doc.font("Helvetica").fontSize(8).fillColor(GREY);
  const foot = [seller.bank_details && `Règlement : ${seller.bank_details}`, seller.invoice_footer].filter(Boolean).join("\n");
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    if (foot) doc.text(clean(foot), left, doc.page.height - 100, { width, align: "center", lineBreak: true });
    doc.text(clean(`${seller.store_name} — ${seller.tagline} · page ${i + 1}/${pages.count}`), left, doc.page.height - 56, { width, align: "center" });
    if (inv.status !== "issued") {
      doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] })
        .font("Helvetica-Bold").fontSize(70).fillColor(inv.status === "cancelled" ? "#dc2626" : "#94a3b8").opacity(0.18)
        .text(inv.status === "cancelled" ? "ANNULÉE" : "BROUILLON", 0, doc.page.height / 2 - 40, { width: doc.page.width, align: "center" })
        .restore();
      if (inv.status === "cancelled" && i === 0) {
        doc.opacity(1).font("Helvetica-Bold").fontSize(9).fillColor("#dc2626")
          .text(clean(`Facture annulée le ${inv.cancelled_at ? new Date(inv.cancelled_at).toISOString().slice(0, 10).split("-").reverse().join("/") : ""} — motif : ${inv.cancel_reason}`), left, 112, { width });
      }
    }
  }
  doc.end();
  return done;
}
