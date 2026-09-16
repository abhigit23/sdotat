import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ThemeToggle from "@/components/theme-toggle";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://sdotat.vercel.app"),
  title: "s.at — Short, self-destructing pastes",
  description:
    "Share short links to pastes that can expire, require a password, or burn after being read.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce");

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          nonce={nonce ?? undefined}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(typeof trustedTypes!=="undefined"&&typeof trustedTypes.createPolicy==="function"){trustedTypes.createPolicy("default",{createHTML:s=>s,createScriptURL:s=>s});}}catch(e){}})();`,
          }}
        />
        <script
          nonce={nonce ?? undefined}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||((!t||t==='system')&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
        {children}
        <ThemeToggle />
        <footer className="py-6 text-center text-xs text-zinc-400">
          &copy; {new Date().getFullYear()} s.at — server-side encrypted pastes
        </footer>
      </body>
    </html>
  );
}
