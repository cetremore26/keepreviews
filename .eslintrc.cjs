/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "@remix-run/eslint-config/jest-testing-library",
    "prettier",
  ],
  globals: {
    shopify: "readonly"
  },
  settings: {
    // The tests run on vitest, so there is no jest package for the jest
    // plugin (pulled in by the Remix config above) to detect a version from.
    jest: { version: 29 },
  },
};
