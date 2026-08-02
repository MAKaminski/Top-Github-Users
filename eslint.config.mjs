import next from "eslint-config-next";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

/**
 * Flat config for Next.js 16 + TypeScript.
 *
 * `eslint-config-next@16` ships native flat configs, so there is no FlatCompat
 * shim here. Three layers, in order:
 *
 *   next                  — React, react-hooks, jsx-a11y, import, @next/next
 *   next/core-web-vitals  — promotes the Core Web Vitals rules to errors
 *   next/typescript       — typescript-eslint recommended (non type-aware)
 *
 * @type {import("eslint").Linter.Config[]}
 */
const config = [
  {
    // Build output, vendored code and the committed data snapshot. `data/` is
    // machine-generated JSON written by `pnpm seed` / the crawler and is not
    // source we lint.
    ignores: [".next/**", "node_modules/**", "data/**", "out/**", "next-env.d.ts"],
  },

  ...next,
  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    rules: {
      // The codebase's convention for an intentionally unused binding is a
      // leading underscore; everything else stays an error.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // React Compiler advisory rules, new in eslint-plugin-react-hooks 6.
      // Both fire on idioms this codebase uses deliberately and documents in
      // place, and neither reports a defect:
      //
      //   set-state-in-effect — the motion patterns must feature-detect
      //     (matchMedia, CSS.supports, IntersectionObserver) after mount,
      //     because reading those during render breaks hydration. The rule's
      //     own message is about cascading renders, i.e. performance.
      //   refs — the "latest ref" idiom in components/patterns/use-raf.ts,
      //     which keeps a per-frame callback current without re-subscribing.
      //
      // Warned rather than switched off, so new instances still surface.
      // react-hooks/purity is NOT downgraded: an impure render is a real
      // hydration bug, not a style preference.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },

  {
    // Node-side scripts and the Playwright sweep: plain ES modules run by tsx /
    // node, not bundled into the app, so the Next.js-specific rules about
    // next/image and next/link do not apply.
    files: ["scripts/**/*.ts", "scripts-shared/**/*.ts", "tests/**/*.mjs"],
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-img-element": "off",
    },
  },
];

export default config;
