import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { WalletProvider } from "@/lib/wallet/provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "MarkDesk — mark-relative private market orders",
  description:
    "Create auditable PreStocks offers relative to the latest official mark and settle atomically on Solana.",
  metadataBase: new URL("https://markdesk.invalid"),
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0a0d0c",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
