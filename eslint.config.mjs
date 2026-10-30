import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    // eslint-config-next 16 enables the React Compiler purity rules as errors.
    // The app does not use the compiler, and the engine components (Globe,
    // StreetEngine) deliberately hold imperative state in refs and sync props
    // in effects. Keep the findings visible as warnings until those
    // components are reworked.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "benchmarks/results/**",
      "screenshots/**",
      "out/**",
    ],
  },
];

export default eslintConfig;
