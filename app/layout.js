import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import Header from "@/components/header";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

// Browser extensions (form fillers, password managers, antivirus) tag inputs,
// buttons and divs with attributes like fdprocessedid before React hydrates,
// which triggers hydration mismatch errors. Next runs this just before
// hydration: strip what's already tagged, keep stripping new tags, then stop
// watching once the page (and hydration) has finished loading.
const stripExtensionAttributes = `(function () {
  var attrs = ["fdprocessedid", "bis_skin_checked", "bis_register"];
  var strip = function (el) {
    for (var i = 0; i < attrs.length; i++) el.removeAttribute(attrs[i]);
  };
  var tagged = document.querySelectorAll("[" + attrs.join("],[") + "]");
  for (var i = 0; i < tagged.length; i++) strip(tagged[i]);
  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) strip(mutations[i].target);
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: attrs,
    subtree: true,
  });
  window.addEventListener("load", function () {
    setTimeout(function () { observer.disconnect(); }, 5000);
  });
})();`;

export const metadata = {
  title: "Vehiqle",
  description: "Find your Dream Car",
};

export default function RootLayout({ children }) {
  return (
    <ClerkProvider>
      {/* suppressHydrationWarning only covers attributes on <html>/<body>
          themselves (extensions like Grammarly add some there), not children */}
      <html lang="en" suppressHydrationWarning>
        {/* Icons come from app/favicon.ico, app/icon.svg and app/apple-icon.png */}
        <body className={`${inter.className}`} suppressHydrationWarning>
          <Script id="strip-extension-attributes" strategy="beforeInteractive">
            {stripExtensionAttributes}
          </Script>
          <Header />
          <main className="min-h-screen">{children}</main>
          <Toaster richColors />
        </body>
      </html>
    </ClerkProvider>
  );
}
