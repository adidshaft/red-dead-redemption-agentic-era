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

const siteUrl = "https://rdr.kyokasuigetsu.xyz";
const title = "Red Dead Redemption: Agentic Era";
const description = "Agentic western arena game on X Layer with OnchainOS.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: title,
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: title,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/twitter-image"],
  },
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
