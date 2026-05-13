import type { Finding, Gazette, SupplierProfile, SkillResult } from '../types'
import type { extractEntities as _extractEntities } from '../skills/extract_entities'
import type { saveMemory as _saveMemory } from '../skills/save_memory'
import type { SanctionResult } from '../skills/check_sanctions'
import type {
  QuerySuppliersContractInput,
  SupplierContractRecord,
} from '../skills/query_suppliers_contract'

/**
 * Contrato de injeção de dependências para todos os Fiscais.
 *
 * **Regra de ouro:** toda skill com side-effect externo (AWS DynamoDB,
 * Anthropic API, Querido Diário API, Receita Federal API) DEVE ser
 * declarada aqui como campo opcional e injetada via `context` em vez
 * de importada diretamente na lógica do Fiscal. Isso garante:
 *  - Testabilidade: testes rodam sem AWS real nem Anthropic real.
 *  - Extensibilidade: futuros Fiscais (Contratos, Fornecedores, Pessoal)
 *    herdam o mesmo padrão de DI apenas declarando os campos que precisam.
 *
 * **Injetáveis padrão (MVP):**
 *  1. `extractEntities`    — Haiku extrai CNPJ, valor, secretaria, tipo do ato (Anthropic API)
 *  2. `queryAlertsByCnpj`  — consulta histórico de dispensas no DynamoDB (AWS)
 *     TODO: renomear para `queryDispensasByCnpj` quando MIT-02 for desbloqueado
 *     (depende de range_key em suppliers-prod)
 *  3. `generateNarrative`  — Haiku gera texto factual com fonte citada (Anthropic API)
 *  4. `saveMemory`         — persiste entidade/achado no DynamoDB (AWS)
 *  5. `validateCNPJ`       — BrasilAPI: data de abertura, situação cadastral (Receita Federal)
 *                            Declarado como opcional — usado apenas pelo Fiscal de Fornecedores.
 *                            Fallback ao import direto quando não injetado.
 */
export interface FiscalContext {
  alertsTable?: string                                                                    // default 'fiscal-digital-alerts-prod'
  now?: () => Date                                                                        // default () => new Date()
  extractEntities?: typeof _extractEntities                                               // permite mock em teste
  queryAlertsByCnpj?: (cnpj: string, sinceISO: string) => Promise<Finding[]>            // injetável p/ teste
  generateNarrative?: (...args: unknown[]) => Promise<string>                            // mock em teste
  saveMemory?: typeof _saveMemory                                                         // permite mock em teste
  validateCNPJ?: (input: { cnpj: string }) => Promise<SkillResult<Partial<SupplierProfile>>>  // Fiscal de Fornecedores
  checkSanctions?: (input: { cnpj: string }) => Promise<SkillResult<SanctionResult>>           // Fiscal de Fornecedores (CEIS/CNEP CGU)
  /**
   * Cross-reference de contrato original em `suppliers-prod` (EVO-002).
   * Usado pelo FiscalContratos para calcular % de aditivo. Retorna null se
   * o contrato original não está cadastrado.
   */
  querySuppliersContract?: (
    input: QuerySuppliersContractInput,
  ) => Promise<SkillResult<SupplierContractRecord | null>>
}

export interface AnalisarInput {
  gazette: Gazette
  cityId: string
  context?: FiscalContext
}

export interface Fiscal {
  id: string
  description: string
  analisar(input: AnalisarInput): Promise<Finding[]>
}
