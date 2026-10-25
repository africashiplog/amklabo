import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";

export const metadata: Metadata = {
  title: { default: "AMKLABO — Medical & Laboratory", template: "%s · AMKLABO" },
  description: "Matériel médical, matériel de laboratoire et consommables médicaux en Mauritanie.",
  icons: { icon: "/brand/icon.png" },
};

export const viewport: Viewport = { themeColor: "#03589a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = DEFAULT_LOCALE;
  return (
    <html lang={locale} dir={LOCALES[locale].dir}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
