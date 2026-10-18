import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vittavani — A product of Vinayaka Services",
  description: "Find your stock and storage locations by asking naturally.",
  applicationName: "Vittavani",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
