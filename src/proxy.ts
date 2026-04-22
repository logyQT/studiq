import createMiddleware from "next-intl/middleware";

export const proxy = createMiddleware({
  locales: ["pl", "en"],
  defaultLocale: "pl",
  localePrefix: "never",
});

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
