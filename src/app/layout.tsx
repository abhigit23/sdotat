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
        <footer className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-6 text-center text-xs text-zinc-400">
          <span>
            &copy; {new Date().getFullYear()} s.at — server-side encrypted pastes
          </span>
          <span aria-hidden className="text-zinc-300 dark:text-zinc-600">
            ·
          </span>
          <a
            href="https://github.com/abhigit23/sdotat"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-zinc-500 underline-offset-4 hover:text-zinc-700 hover:underline dark:text-zinc-500 dark:hover:text-zinc-200"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden
              className="h-3.5 w-3.5"
            >
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            Source on GitHub
          </a>
        </footer>
      </body>
    </html>
  );
}
