import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navigation from "@/components/Navigation";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ThalaivarSwap - Cross-Chain ETH ↔ DOT Swaps",
  description: "Seamless cross-chain swaps between Ethereum and Polkadot using 1inch Fusion+ technology",
  keywords: ["cross-chain", "swap", "ethereum", "polkadot", "defi", "1inch", "fusion"],
  authors: [{ name: "ThalaivarSwap Team" }],
  openGraph: {
    title: "ThalaivarSwap - Cross-Chain ETH ↔ DOT Swaps",
    description: "Seamless cross-chain swaps between Ethereum and Polkadot",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900">
          <Navigation />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}