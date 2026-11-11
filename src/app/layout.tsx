import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProcessIQ | Manufacturing Investigation",
  description: "Evidence-backed manufacturing incident investigation.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
