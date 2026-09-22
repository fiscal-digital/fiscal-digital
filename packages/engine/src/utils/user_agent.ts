/**
 * Identificacao unica do projeto em toda chamada HTTP a fontes externas.
 *
 * Um so valor para API do Querido Diario, downloads de PDF e proxy da API
 * publica. Antes havia tres strings diferentes (`0.1.1`, `1.0`) enquanto a
 * engine ja estava em 0.1.3 — quem olha o log do lado de la nao consegue
 * saber que e o mesmo cliente.
 *
 * A versao aqui e mantida em sincronia com `package.json` por TESTE
 * (`user_agent.test.ts`), nao por leitura em runtime: `package.json` fica
 * fora do `rootDir` do tsc e nao entra no bundle.
 */
export const USER_AGENT = 'FiscalDigital/0.1.5 (+https://fiscaldigital.org)'
