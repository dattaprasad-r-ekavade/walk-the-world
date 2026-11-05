import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
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
