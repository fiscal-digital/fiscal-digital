export type FindingType =
  | 'fracionamento'
  | 'cnpj_jovem'
  | 'aditivo_abusivo'
  | 'prorrogacao_excessiva'
  | 'pico_nomeacoes'
  | 'concentracao_fornecedor'
  | 'dispensa_irregular'
  | 'inexigibilidade_sem_justificativa'

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
}
