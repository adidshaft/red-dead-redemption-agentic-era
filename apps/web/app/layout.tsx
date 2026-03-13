import type { Metadata } from "next";
import { Bricolage_Grotesque, Rye } from "next/font/google";

import "./globals.css";

import { Providers } from "../components/providers";

const heading = Rye({
  variable: "--font-heading",
  weight: "400",
  subsets: ["latin"],
});

const body = Bricolage_Grotesque({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Red Dead Redemption: Agentic Era",
  description: "Agentic western arena game on X Layer with OnchainOS.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${heading.variable} ${body.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
