import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vittavani | Your business, easier to manage",
  description: "A voice-first business assistant for Indian small businesses.",
  applicationName: "Vittavani",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
