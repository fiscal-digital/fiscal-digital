import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'terraform/**',
      'packages/engine/brand/**',
      'packages/engine/scripts/**',
    ],
  },

  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['packages/**/src/**/*.ts'],
    rules: {
      ...config.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',

      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TSNonNullExpression[expression.type='MemberExpression'][expression.object.type='MemberExpression'][expression.object.object.name='process'][expression.object.property.name='env']",
          message:
            "Não use `process.env.X!` — usar `requireEnv('X')` de packages/engine/src/env.ts (LRN TEC-ENG-001). O `!` mascara variáveis ausentes em runtime; `requireEnv` lança com nome da variável faltante.",
        },
      ],
    },
  })),

  {
    files: ['packages/**/src/__tests__/**/*.ts', 'packages/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
]
