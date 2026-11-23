import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "EcomNext", template: "%s · EcomNext" },
  description: "Book, ship, track and manage every order from one place.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
