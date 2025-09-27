module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  env: {
    es2022: true,
    node: true,
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.ts'],
      },
      typescript: {
        project: ['packages/*/tsconfig.json'],
      },
    },
  },
  ignorePatterns: ['dist/**/*'],
  rules: {
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'import/order': ['warn', { 'newlines-between': 'always' }],
  },
  overrides: [
    {
      files: ['**/*.test.ts'],
      env: {
        node: true,
      },
    },
  ],
};
