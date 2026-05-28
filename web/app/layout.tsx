import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import "./globals.css";
import { SessionProvider } from "@/components/SessionProvider";
import { Header } from "@/components/Header";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://myfilmprint.com"),
  title: "filmprint",
  description: "Personalized movie recommendations from your Letterboxd taste",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getServerSession(authOptions);

  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        <SessionProvider session={session}>
          <Header />
          <main className="flex-1">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
