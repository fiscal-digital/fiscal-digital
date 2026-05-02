export type FindingType =
  | 'fracionamento'
  | 'cnpj_jovem'
  | 'aditivo_abusivo'
  | 'prorrogacao_excessiva'
  | 'pico_nomeacoes'
  | 'rotatividade_anormal'
  | 'concentracao_fornecedor'
  | 'dispensa_irregular'
  | 'inexigibilidade_sem_justificativa'
  | 'padrao_recorrente'

export interface Evidence {
  source: string   // URL do Querido Diário — OBRIGATÓRIO
  excerpt: string
  date: string     // YYYY-MM-DD
}

export interface Skill<TInput = unknown, TData = unknown> {
  name: string
  description: string
  execute(input: TInput): Promise<SkillResult<TData>>
}

export interface SkillResult<TData = unknown> {
  data: TData
  source: string      // URL do Querido Diário — OBRIGATÓRIO
  confidence: number  // 0.0 a 1.0
}

export interface Finding {
  id?: string
  fiscalId: string
  cityId: string
  type: FindingType
  riskScore: number    // 0–100
  confidence: number   // 0.0–1.0
  evidence: Evidence[]
  narrative: string
  legalBasis: string
  cnpj?: string
  secretaria?: string
  value?: number
  contractNumber?: string
  published?: boolean
  publishedAt?: string
  createdAt?: string
}

export interface Gazette {
  id: string
  territory_id: string
  date: string       // YYYY-MM-DD
  url: string
  excerpts: string[]
  edition?: string
  is_extra?: boolean
}

export interface ExtractedEntities {
  cnpjs: string[]
  values: number[]
  dates: string[]
  contractNumbers: string[]
  secretaria?: string
  actType?: string
  supplier?: string
  legalBasis?: string
  /**
   * Classifica o objeto da contratação para inferir o inciso aplicável da
   * Lei 14.133/2021, Art. 75 (I vs II).
   *
   * - `obra_engenharia` — obras civis, reforma de imóvel, pavimentação.
   *   Aplica-se o inciso I (teto maior).
   * - `servico`         — consultoria, manutenção não-imobiliária, eventos,
   *   limpeza. Aplica-se o inciso II (teto menor).
   * - `compra`          — aquisição de bens, equipamentos, veículos.
   *   Aplica-se o inciso II (teto menor).
   * - `null`            — ambíguo; fallback para heurística regex (OBRA_RE).
   */
  subtype?: 'obra_engenharia' | 'servico' | 'compra' | null
  /**
   * Valor monetário original do contrato — preenchido apenas em excerpts de aditivos
   * que citam explicitamente o valor original. null/undefined = não citado, fallback
   * para lookup histórico em alerts-prod.
   */
  valorOriginalContrato?: number
}

export interface SupplierProfile {
  cnpj: string
  razaoSocial: string
  situacaoCadastral: string
  dataAbertura: string   // YYYY-MM-DD
  socios: string[]
  totalContratos: number
  totalValor: number
  cidades: string[]
  sanctions: boolean
  lastUpdated: string
}

export interface RiskFactor {
  type: string
  weight: number   // 0–1, soma dos weights deve ser 1
  value: number    // 0–100
  description: string
}

export interface CollectorMessage {
  gazetteId: string
  territory_id: string
  date: string
  url: string
  excerpts: string[]
  entities: ExtractedEntities
  /**
   * UH-22 Phase 2 — State tracking.
   * Quando presente, o analyzer roda APENAS os Fiscais listados (ignora os demais).
   * Quando ausente, roda todos os Fiscais ativos (comportamento padrão / cron diário).
   *
   * Usado por `reanalyze.mjs` para rodar só um Fiscal novo sobre histórico
   * sem re-executar Fiscais já processados.
   *
   * IDs válidos: 'fiscal-licitacoes' | 'fiscal-contratos' | 'fiscal-fornecedores' | 'fiscal-pessoal'
   */
  enabledFiscals?: string[]
}
