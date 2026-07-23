/**
 * @fiscal-digital/contracts — fonte da verdade do contrato público engine ↔ web.
 *
 * TST-010..014 (Test Hardening, Fase 1). Cada endpoint público da API tem aqui
 * um schema zod; os tipos TypeScript saem de `z.infer` — não se declara tipo à
 * mão dos dois lados.
 *
 * REGRA DE OURO: este arquivo não importa NADA além de `zod`. O repo
 * `fiscal-digital-web` sincroniza este arquivo cru (raw.githubusercontent, ambos
 * os repos são públicos) e o compila junto — qualquer import relativo quebraria
 * a sincronização. Mesmo espírito do `sync-brand.mjs`.
 *
 * Convenção nullable vs optional (importa para o web!):
 *   .nullable()  → a chave SEMPRE vem no JSON, valor pode ser null
 *   .optional()  → a chave pode NÃO existir no JSON (campo ausente no item)
 */
import { z } from 'zod'

// ─── Tipos de achado ─────────────────────────────────────────────────────────
//
// Fonte única. Antes triplicado: FindingType (engine/types), typeLabel (api) e
// FINDING_TYPE_LABELS (web/lib/findings). Adicionar um Fiscal novo = adicionar
// aqui, e os três consumidores acompanham.

export const FINDING_TYPES = [
  'fracionamento',
  'cnpj_jovem',
  'aditivo_abusivo',
  'prorrogacao_excessiva',
  'pico_nomeacoes',
  'rotatividade_anormal',
  'concentracao_fornecedor',
  'dispensa_irregular',
  'inexigibilidade_sem_justificativa',
  'padrao_recorrente',
  'convenio_sem_chamamento',
  'repasse_recorrente_osc',
  'diaria_irregular',
  'publicidade_eleitoral',
  'locacao_sem_justificativa',
  'nepotismo_indicio',
  'cnpj_situacao_irregular',
  'fornecedor_sancionado',
] as const

export const findingTypeSchema = z.enum(FINDING_TYPES)
export type FindingType = z.infer<typeof findingTypeSchema>

export const FINDING_TYPE_LABELS: Record<FindingType, { 'pt-br': string; 'en-us': string }> = {
  dispensa_irregular: { 'pt-br': 'Dispensa irregular', 'en-us': 'Irregular waiver' },
  fracionamento: { 'pt-br': 'Fracionamento', 'en-us': 'Contract splitting' },
  aditivo_abusivo: { 'pt-br': 'Aditivo abusivo', 'en-us': 'Abusive amendment' },
  prorrogacao_excessiva: { 'pt-br': 'Prorrogação excessiva', 'en-us': 'Excessive extension' },
  cnpj_jovem: { 'pt-br': 'CNPJ jovem', 'en-us': 'New company' },
  concentracao_fornecedor: { 'pt-br': 'Concentração de fornecedor', 'en-us': 'Supplier concentration' },
  pico_nomeacoes: { 'pt-br': 'Pico de nomeações', 'en-us': 'Appointment spike' },
  rotatividade_anormal: { 'pt-br': 'Rotatividade anormal', 'en-us': 'Abnormal turnover' },
  inexigibilidade_sem_justificativa: { 'pt-br': 'Inexigibilidade sem justif.', 'en-us': 'Unjustified non-bid' },
  padrao_recorrente: { 'pt-br': 'Padrão recorrente', 'en-us': 'Recurring pattern' },
  convenio_sem_chamamento: { 'pt-br': 'Convênio sem chamamento', 'en-us': 'Agreement without call' },
  repasse_recorrente_osc: { 'pt-br': 'Repasse recorrente a OSC', 'en-us': 'Recurring NGO transfer' },
  diaria_irregular: { 'pt-br': 'Diária irregular', 'en-us': 'Irregular per diem' },
  publicidade_eleitoral: { 'pt-br': 'Publicidade em janela vedada', 'en-us': 'Electoral publicity' },
  locacao_sem_justificativa: { 'pt-br': 'Locação sem justificativa', 'en-us': 'Lease without justification' },
  nepotismo_indicio: { 'pt-br': 'Indício de nepotismo', 'en-us': 'Nepotism indicator' },
  cnpj_situacao_irregular: { 'pt-br': 'CNPJ situação irregular', 'en-us': 'Irregular CNPJ status' },
  fornecedor_sancionado: { 'pt-br': 'Fornecedor sancionado (CGU)', 'en-us': 'Sanctioned supplier (CGU)' },
}

// ─── Evidence ────────────────────────────────────────────────────────────────
//
// `date` é opcional no contrato porque o OpenAPI declara required apenas
// source+excerpt. O web ordenava por `evidence[0].date` assumindo obrigatório e
// caía em 0 silenciosamente quando ausente — com o schema, o consumidor é
// forçado a tratar o caso.

export const evidenceSchema = z.object({
  source: z.string(),
  excerpt: z.string(),
  date: z.string().optional(),
})
export type Evidence = z.infer<typeof evidenceSchema>

// ─── Alerta (item de /alerts) ────────────────────────────────────────────────

export const alertItemSchema = z.object({
  id: z.string(),
  fiscalId: z.string(),
  type: findingTypeSchema,
  cityId: z.string(),
  city: z.string(),
  state: z.string(),
  riskScore: z.number(),
  // Estava ausente na tipagem do web mesmo sendo required no OpenAPI.
  confidence: z.number(),
  value: z.number().optional(),
  cnpj: z.string().optional(),
  contractNumber: z.string().optional(),
  secretaria: z.string().optional(),
  // Obrigatórios na interface Finding da engine (types/index.ts) — todo finding
  // persistido os tem.
  legalBasis: z.string(),
  narrative: z.string(),
  // A API só emite `source` quando existe evidence[0].source — o web tipava
  // como obrigatório e recebia undefined em runtime.
  source: z.string().optional(),
  cachedPdfUrl: z.string().nullable(),
  pdfProxyUrl: z.string().nullable(),
  evidence: z.array(evidenceSchema),
  published: z.boolean().optional(),
  publishedAt: z.string().optional(),
  // `required` no OpenAPI (openapi.ts:511) e sempre setado por persistFinding —
  // não é opcional na resposta, ainda que opcional na interface interna.
  createdAt: z.string(),
})
export type AlertItem = z.infer<typeof alertItemSchema>

export const pageInfoSchema = z.object({
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
  totalValue: z.number(),
  citiesCount: z.number(),
})
export type PageInfo = z.infer<typeof pageInfoSchema>

/** Chave `cityId` (não `city`, que é o nome do query param de entrada). */
export const alertsFiltersSchema = z.object({
  cityId: z.string().optional(),
  state: z.string().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
})

export const alertsResponseSchema = z.object({
  /** Redundante com pageInfo.total; mantido por retrocompatibilidade. */
  total: z.number(),
  filters: alertsFiltersSchema,
  pageInfo: pageInfoSchema,
  items: z.array(alertItemSchema),
})
export type AlertsResponse = z.infer<typeof alertsResponseSchema>

/**
 * GET /alerts/{slug} — objeto FLAT (não envelopado) e com menos campos que o
 * item de /alerts: sem pdfProxyUrl/published/publishedAt.
 */
export const alertDetailSchema = alertItemSchema
  .omit({ pdfProxyUrl: true, published: true, publishedAt: true })
  .extend({ evidence: z.array(evidenceSchema).optional() })
export type AlertDetail = z.infer<typeof alertDetailSchema>

// ─── Cidades ─────────────────────────────────────────────────────────────────

export const dataStatusSchema = z.enum(['atualizada', 'estagnada', 'sem-dados'])
export type DataStatus = z.infer<typeof dataStatusSchema>

/** Limiar de cobertura estagnada, em dias (espelha a API). */
export const STALE_THRESHOLD_DAYS = 7

export const citySchema = z.object({
  cityId: z.string(),
  name: z.string(),
  slug: z.string(),
  uf: z.string(),
  active: z.boolean(),
  findingsCount: z.number(),
  lastFindingAt: z.string().nullable(),
  lastGazetteDate: z.string().nullable(),
  staleDays: z.number().nullable(),
  dataStatus: dataStatusSchema,
})
export type City = z.infer<typeof citySchema>

export const citiesResponseSchema = z.array(citySchema)
export type CitiesResponse = z.infer<typeof citiesResponseSchema>

export const cityStatsSchema = z.object({
  cityId: z.string(),
  totalGazettesProcessed: z.number(),
  totalFindings: z.number(),
  lastFindingAt: z.string().nullable(),
  periodCovered: z.object({ from: z.string(), to: z.string() }).nullable(),
  lastGazetteDate: z.string().nullable(),
  staleDays: z.number().nullable(),
  dataStatus: dataStatusSchema,
})
export type CityStats = z.infer<typeof cityStatsSchema>

// ─── Stats globais ───────────────────────────────────────────────────────────

export const statsResponseSchema = z.object({
  totalFindings: z.number(),
  totalGazettesProcessed: z.number().nullable(),
  findingsByFiscal: z.record(z.string(), z.number()),
  findingsByCity: z.array(z.object({
    cityId: z.string(),
    name: z.string(),
    count: z.number(),
  })),
  findingsByType: z.record(z.string(), z.number()),
  estimatedCostBrl: z.number(),
  lastFindingAt: z.string().nullable(),
  uptimeDays: z.number(),
})
export type StatsResponse = z.infer<typeof statsResponseSchema>

// ─── Transparência de custos ─────────────────────────────────────────────────

export const costServiceBreakdownSchema = z.object({
  service: z.string(),
  usd: z.number(),
  brl: z.number(),
})

export const costDailySchema = z.object({
  date: z.string(),
  totalBrl: z.number(),
  totalUsd: z.number(),
  byService: z.array(costServiceBreakdownSchema),
  ptaxBrl: z.number().nullable(),
})

/**
 * Sem `pk`: a chave interna do DynamoDB não faz parte do contrato público
 * (vazava na resposta antes do TST-010..014).
 */
export const costMonthlySchema = z.object({
  month: z.string(),
  mtdUsd: z.number(),
  mtdBrl: z.number(),
  projectedUsd: z.number(),
  projectedBrl: z.number(),
  prevMonthBrl: z.number().nullable(),
  deltaPct: z.number().nullable(),
  byService: z.array(costServiceBreakdownSchema),
  ptaxBrl: z.number().nullable(),
  capturedAt: z.string(),
})

export const costsResponseSchema = z.object({
  currency: z.literal('BRL'),
  days: z.number(),
  updatedAt: z.string().nullable(),
  monthly: costMonthlySchema.nullable(),
  daily: z.array(costDailySchema),
})
export type CostsResponse = z.infer<typeof costsResponseSchema>

export const costMtdResponseSchema = z.object({
  currency: z.literal('BRL'),
  month: z.string(),
  mtdBrl: z.number(),
  projectedBrl: z.number(),
  lifetimeBrl: z.number(),
  deltaPct: z.number().nullable(),
  updatedAt: z.string().nullable(),
  source: z.literal('aws-cost-explorer'),
})
export type CostMtdResponse = z.infer<typeof costMtdResponseSchema>

// ─── Fornecedor ──────────────────────────────────────────────────────────────

export const supplierResponseSchema = z.object({
  cnpj: z.string(),
  cnpjRaw: z.string(),
  profile: z.object({
    razaoSocial: z.string().nullable(),
    situacaoCadastral: z.string().nullable(),
    dataAbertura: z.string().nullable(),
    socios: z.array(z.string()),
    sancoes: z.array(z.unknown()),
    rfbCapturedAt: z.string().nullable(),
    cguCapturedAt: z.string().nullable(),
    cguEnabled: z.boolean().nullable(),
    lastLookupAt: z.string().nullable(),
    rfbStatus: z.string().nullable(),
  }).nullable(),
  contracts: z.array(z.object({
    contractedAt: z.string().nullable(),
    contractNumber: z.string().nullable(),
    valueAmount: z.number().nullable(),
    secretaria: z.string().nullable(),
    cityId: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    sourceFindingId: z.string().nullable(),
  })),
  findings: z.array(z.object({
    id: z.string(),
    type: z.string(),
    riskScore: z.number(),
    narrative: z.string().optional(),
    source: z.string().nullable(),
    createdAt: z.string().optional(),
    cityId: z.string(),
    city: z.string().nullable(),
    state: z.string().nullable(),
  })),
  stats: z.object({
    totalContracts: z.number(),
    totalValueBrl: z.number(),
    cities: z.array(z.string()),
  }),
})
export type SupplierResponse = z.infer<typeof supplierResponseSchema>

// ─── Health ──────────────────────────────────────────────────────────────────

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  cities: z.number(),
  lastDeployedAt: z.string(),
  endpoints: z.array(z.string()),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>
