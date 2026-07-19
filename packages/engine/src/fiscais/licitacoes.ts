import { extractEntities as defaultExtractEntities } from '../skills/extract_entities'
import { saveMemory } from '../skills/save_memory'
import { generateNarrative as defaultGenerateNarrative } from '../skills/generate_narrative'
import { scoreRisk } from '../skills/score_risk'
import { getPublishThresholds } from '../thresholds'
import type { Evidence, Finding, RiskFactor } from '../types'
import { gazetteKey } from '../utils/pdf_cache'
import { LEI_14133_ART_75_I_LIMITE, LEI_14133_ART_75_II_LIMITE } from './legal-constants'
import type { Fiscal, AnalisarInput, FiscalContext } from './types'

const FISCAL_ID = 'fiscal-licitacoes'
const ALERTS_TABLE_DEFAULT = 'fiscal-digital-alerts-prod'

// Regex de filtro etapa 1
const DISPENSA_RE = /dispensa\s+(de\s+)?licita[çc][ãa]o/i
const ART_75_RE = /art(?:igo)?\.?\s*75/i

// Regex para classificação inciso I (obras/engenharia)
const OBRA_RE = /(obra|engenharia|reforma|constru[çc][ãa]o|pavimenta[çc][ãa]o|edifica[çc][ãa]o|drenagem|terraplenagem|recupera[çc][ãa]o\s+estrutural)/i

// ── Filtros de exclusão (ADR-001 + padrões Ciclo 2) ─────────────────────────
// Atos que pertencem a OUTROS Fiscais (vazamento de escopo):
//   - Locação de imóvel → FiscalLocação (Art. 74 III, sem teto)
//   - Termo Aditivo → FiscalContratos (Art. 125, não nova dispensa)
//   - Designação de Fiscal de Contrato → não é nova contratação

const LOCACAO_IMOVEL_RE = /\bloca[çc][ãa]o\s+de\s+im[óo]vel\b/i
const TERMO_ADITIVO_LICITACOES_RE = /\b(termo\s+aditivo|aditamento|prorrog\w+|apostilamento)\b/i
const DESIGNAR_FISCAL_LICITACOES_RE = /\b(designar|nomear|nomeia|designa)\b[\s\S]{0,200}\b(gestor|fiscal)\b[\s\S]{0,300}\b(de\s+|do\s+)?contrato\b/i

// ── Hipóteses sem teto da Lei 14.133 Art. 75 ────────────────────────────────
// III: fornecedor exclusivo / única fornecedora (notória especialização)
// IV: emergência / calamidade pública / urgência declarada / sanitária
// VIII: insumos / medicamentos / produtos de saúde
// IX: contratação entre entes da administração pública
// XV: ciência/tecnologia (universidade pública, fundação de apoio)

const HIPOTESE_FORNECEDOR_EXCLUSIVO_RE =
  /\b(fornecedor\s+exclusivo|[úu]nica\s+(?:fornecedora|fabricante)|not[óo]ria\s+especializa[çc][ãa]o|exclusividade\s+comprovada)\b/i
const HIPOTESE_EMERGENCIA_RE =
  /\b(emerg[êe]ncia|calamidade(\s+p[úu]blica)?|urg[êe]ncia\s+(?:declarada|sanit[áa]ria)|estado\s+de\s+(?:emerg[êe]ncia|calamidade)\s+p[úu]blica|contrata[çc][ãa]o\s+emergencial)\b/i
const HIPOTESE_INSUMOS_SAUDE_RE =
  /\b(medicamento|insumo\s+(?:m[ée]dico|hospitalar|farmac[êe]utico|de\s+sa[úu]de)|[óo]rtese|pr[óo]tese|vacina|imunobiol[óo]gico|equipamento\s+hospitalar)\b/i
const HIPOTESE_ENTES_PUBLICOS_RE =
  /\b(?:art(?:igo)?\.?\s*75\s*(?:,|\s)?\s*(?:inciso\s+)?IX|Art\.\s*75\s+IX)\b|\bcontrata[çc][ãa]o\s+entre\s+entes\s+da\s+administra[çc][ãa]o\b/i
const HIPOTESE_CIENCIA_TECNOLOGIA_RE =
  /\b(?:art(?:igo)?\.?\s*75\s*(?:,|\s)?\s*(?:inciso\s+)?XV|Art\.\s*75\s+XV)\b|\b(?:universidade|funda[çc][ãa]o\s+de\s+(?:apoio|pesquisa|ensino))\b[\s\S]{0,80}\b(p[úu]blica|estadual|federal|municipal)\b/i

function isVazamentoEscopo(excerpt: string): boolean {
  if (LOCACAO_IMOVEL_RE.test(excerpt)) return true
  if (TERMO_ADITIVO_LICITACOES_RE.test(excerpt)) return true
  if (DESIGNAR_FISCAL_LICITACOES_RE.test(excerpt)) return true
  return false
}

function isHipoteseSemTeto(excerpt: string): boolean {
  if (HIPOTESE_FORNECEDOR_EXCLUSIVO_RE.test(excerpt)) return true
  if (HIPOTESE_EMERGENCIA_RE.test(excerpt)) return true
  if (HIPOTESE_INSUMOS_SAUDE_RE.test(excerpt)) return true
  if (HIPOTESE_ENTES_PUBLICOS_RE.test(excerpt)) return true
  if (HIPOTESE_CIENCIA_TECNOLOGIA_RE.test(excerpt)) return true
  return false
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  // YYYY-MM-DD → DD/MM/YYYY
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function narrativaFactual(
  gazetteDate: string,
  valor: number,
  teto: number,
  inciso: 'I' | 'II',
): string {
  return (
    `Identificamos dispensa publicada em ${formatDate(gazetteDate)} no valor de ` +
    `R$ ${formatBRL(valor)}, acima do limite legal de R$ ${formatBRL(teto)} ` +
    `(Lei 14.133/2021, Art. 75, ${inciso}).`
  )
}

function classificarInciso(excerpt: string, subtype?: string | null): 'I' | 'II' {
  if (subtype === 'obra_engenharia') return 'I'
  if (subtype === 'servico' || subtype === 'compra') return 'II'
  // Fallback: heurística regex quando LLM não classificou
  return OBRA_RE.test(excerpt) ? 'I' : 'II'
}

async function generateNarrativaDispensa(
  finding: Finding,
  context: FiscalContext,
  valor: number,
  teto: number,
  inciso: 'I' | 'II',
  gazetteDate: string,
): Promise<string> {
  const { riskThreshold } = await getPublishThresholds()
  if (finding.riskScore >= riskThreshold) {
    const genNarr = context.generateNarrative
    if (genNarr) {
      return genNarr(finding)
    }
    // Use the default generateNarrative skill
    const result = await defaultGenerateNarrative.execute({ finding })
    return result.data
  }
  return narrativaFactual(gazetteDate, valor, teto, inciso)
}

export const fiscalLicitacoes: Fiscal = {
  id: FISCAL_ID,
  description:
    'Detecta dispensas de licitação com valor acima dos tetos da Lei 14.133/2021, Art. 75, ' +
    'e fracionamento de contrato (Art. 75, §1º). Valores 2026 conforme Decreto 12.807/2025.',

  async analisar(input: AnalisarInput): Promise<Finding[]> {
    const { gazette, cityId, context = {} } = input
    const alertsTable = context.alertsTable ?? ALERTS_TABLE_DEFAULT
    const now = context.now ? context.now() : new Date()

    const findings: Finding[] = []

    // Etapa 1 — Filtro regex (sem LLM)
    // Triagem com filtros de vazamento de escopo (ADR-001):
    //   - Locação de imóvel → FiscalLocação (Art. 74 III, sem teto)
    //   - Termo Aditivo → FiscalContratos (Art. 125)
    //   - Designação de Fiscal de Contrato → não é nova contratação
    const relevantExcerpts = gazette.excerpts.filter(e => {
      if (!(DISPENSA_RE.test(e) || ART_75_RE.test(e))) return false
      if (isVazamentoEscopo(e)) return false
      return true
    })

    if (relevantExcerpts.length === 0) {
      return []
    }

    const extractFn = context.extractEntities ?? defaultExtractEntities

    for (const excerpt of relevantExcerpts) {
      // Etapa 2 — Extração
      const extractResult = await extractFn.execute({
        text: excerpt,
        gazetteUrl: gazette.url,
      })

      const entities = extractResult.data
      const { cnpjs, values, secretaria, supplier, legalBasis } = entities

      if (values.length === 0) continue

      const valor = values[0]
      const cnpj = cnpjs[0] ?? undefined

      // Etapa 3 — Classificação Art. 75 I vs II
      const inciso: 'I' | 'II' = classificarInciso(excerpt, entities.subtype)
      const teto = inciso === 'I' ? LEI_14133_ART_75_I_LIMITE : LEI_14133_ART_75_II_LIMITE
      const legalBasisStr = `Lei 14.133/2021, Art. 75, ${inciso}`

      // BUG-FSC-002 (Correção C): calculado uma vez, usado tanto na Etapa 4
      // (pular dispensa_irregular se hipótese sem teto) quanto no campo `temTeto`
      // persistido abaixo (usado para filtrar a soma de fracionamento na Etapa 8).
      const semTeto = isHipoteseSemTeto(excerpt)

      // Para histórico de fracionamento: persistir todas as dispensas (mesmo legais)
      // com actType='dispensa', sem findingType.
      // IMPORTANTE: omitir campos null. Atributos indexados em GSI (cnpj, secretaria)
      // rejeitam NULL — devem estar ausentes ou ser String válida.
      //
      // BUG-FSC-002 (Correção A — field name): campo de valor gravado SEMPRE como
      // `valor` (não `value`). Verificado via `aws dynamodb scan` em
      // fiscal-digital-alerts-prod (2026-07-19, us-east-1): 572/572 itens DISPENSA#
      // reais em prod usam `valor`; nenhum usa `value`. `value` é o nome de campo do
      // tipo `Finding` (achados publicados), não do item de memória DISPENSA#. O
      // fallback dual-read na Etapa 8 (`item.valor ?? item.value`) é mantido por
      // segurança apenas para o caso de `historico` conter um objeto Finding (que usa
      // `value`) em vez de um item DISPENSA# — não porque prod tenha registros
      // legados com `value`.
      const dispensaItem: Record<string, unknown> = {
        fiscalId: FISCAL_ID,
        cityId,
        actType: 'dispensa',
        ...(cnpj && { cnpj }),
        ...(secretaria && { secretaria }),
        ...(supplier && { supplier }),
        valor,
        inciso,
        // BUG-FSC-002 (Correção C): marca se este ato está sujeito ao teto do Art. 75
        // (false = hipótese sem teto, ex. Art. 75 III/IV/VIII/IX/XV — fornecedor
        // exclusivo, emergência, insumo de saúde, ente público, ciência/tecnologia).
        // Itens sem este campo (gravados antes deste fix) são tratados como sujeitos
        // a teto por compatibilidade — corrigido definitivamente via reanalyze.
        temTeto: !semTeto,
        gazetteUrl: gazette.url,
        gazetteDate: gazette.date,
        createdAt: now.toISOString(),
      }

      // Etapa 9 — Confidence final (calculado aqui para uso em ambos os blocos abaixo)
      const hasAllFields = !!(cnpj && valor && gazette.date)

      // Etapa 4 — Detecção dispensa irregular
      // ADR-001: pular se o ato cita hipótese sem teto (Art. 75 III/IV/VIII/IX/XV).
      // Ex: emergência sanitária + agulhas hospitalares = legal mesmo acima de R$ 50k.
      if (valor > teto && !semTeto) {
        // Etapa 5 — RiskFactors
        const legalBasisCitada =
          (legalBasis?.includes('75') && legalBasis.includes('14.133')) ? 80 : 50

        const riskFactors: RiskFactor[] = [
          {
            type: 'excede_teto',
            weight: 0.6,
            value: Math.min(100, ((valor - teto) / teto) * 100 + 60),
            description: `Valor R$ ${formatBRL(valor)} excede teto Art. 75 ${inciso} de R$ ${formatBRL(teto)}`,
          },
          {
            type: 'confianca_extracao',
            weight: 0.2,
            value: extractResult.confidence * 100,
            description: 'Confiança da extração de entidades',
          },
          {
            type: 'base_legal_citada',
            weight: 0.2,
            value: legalBasisCitada,
            description: 'Base legal Art. 75 / Lei 14.133 explicitamente citada',
          },
        ]

        const scoreResult = await scoreRisk.execute({ factors: riskFactors })
        const riskScore = scoreResult.data
        const confidence = Math.min(
          extractResult.confidence,
          hasAllFields ? 0.9 : 0.65,
        )

        const finding: Finding = {
          fiscalId: FISCAL_ID,
          cityId,
          type: 'dispensa_irregular',
          riskScore,
          confidence,
          evidence: [
            {
              source: gazette.url,
              excerpt,
              date: gazette.date,
            },
          ],
          narrative: '',
          legalBasis: legalBasisStr,
          cnpj,
          secretaria: secretaria ?? undefined,
          value: valor,
          createdAt: now.toISOString(),
        }

        // Etapa 6 — Narrativa
        finding.narrative = await generateNarrativaDispensa(
          finding,
          context,
          valor,
          teto,
          inciso,
          gazette.date,
        )

        findings.push(finding)
      }

      // Etapa 8 — Fracionamento
      if (cnpj && context.queryAlertsByCnpj) {
        const twelveMonthsAgo = new Date(now)
        twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)
        const sinceISO = twelveMonthsAgo.toISOString().slice(0, 10)

        const historico = await context.queryAlertsByCnpj(cnpj, sinceISO)

        // Filtrar por mesma cidade, actType=dispensa, e EXCLUIR a propria
        // gazette atual. Reanalyze sobre gazette ja processada antes traz
        // DISPENSA#<gazetteKey atual>#... como historico, gerando contagem
        // dobrada (a atual conta como ela mesma + historico). Issue #53.
        //
        // BUG-FSC-002 (Correção C): exclui também itens marcados `temTeto: false`
        // (hipóteses sem teto do Art. 75 III/IV/VIII/IX/XV — ex.: "Termo de contrato"
        // fundamentado em Art. 75 IX entre entes públicos não é fracionamento, é
        // dispensa legal sem limite de valor). Itens sem o campo `temTeto` (gravados
        // antes deste fix) são tratados como sujeitos a teto por compatibilidade —
        // corrigido definitivamente quando o histórico for reanalisado.
        const dispensasHistorico = historico.filter(f => {
          const item = f as unknown as Record<string, unknown>
          if (f.cityId !== cityId) return false
          if (item.actType !== 'dispensa') return false
          if (item.gazetteUrl === gazette.url) return false
          if (item.temTeto === false) return false
          return true
        })

        // Fracionamento requer pelo menos 1 dispensa anterior para o mesmo CNPJ
        //
        // BUG-FSC-002 (Correção A — field mismatch): campo canônico é `valor`, ver
        // comentário na Etapa 3 (verificado via `aws dynamodb scan` em
        // fiscal-digital-alerts-prod, 2026-07-19: 572/572 itens DISPENSA# reais usam
        // `valor`). Fallback `?? item.value` mantido apenas como defesa caso
        // `historico` contenha um objeto `Finding` (tipo que usa `value`) em vez de
        // um item DISPENSA# — não corresponde a nenhum registro real conhecido hoje.
        const somaHistorico = dispensasHistorico.reduce((s, f) => {
          const item = f as unknown as { valor?: number; value?: number }
          return s + (item.valor ?? item.value ?? 0)
        }, 0)
        const somaTotal = somaHistorico + valor

        // TODO: analisar fracionamento por inciso I também (atualmente só compara com teto II)
        if (dispensasHistorico.length >= 1 && somaTotal > LEI_14133_ART_75_II_LIMITE) {
          const n = dispensasHistorico.length + 1 // inclui a atual

          // Calcular dias entre primeira e última dispensa para janela temporal
          const allDates = dispensasHistorico
            .map(f => f.evidence?.[0]?.date ?? gazette.date)
            .concat([gazette.date])
            .sort()
          const primeiraData = new Date(allDates[0])
          const ultimaData = new Date(allDates[allDates.length - 1])
          const diasEntrePrimeiraUltima = Math.max(
            1,
            (ultimaData.getTime() - primeiraData.getTime()) / (1000 * 60 * 60 * 24),
          )

          const fracaoExcesso = Math.min(100, ((somaTotal - LEI_14133_ART_75_II_LIMITE) / LEI_14133_ART_75_II_LIMITE) * 100 + 60)

          const riskFactorsFrac: RiskFactor[] = [
            {
              type: 'soma_excede_teto',
              weight: 0.5,
              value: fracaoExcesso,
              description: `Soma R$ ${formatBRL(somaTotal)} excede teto Art. 75 II de R$ ${formatBRL(LEI_14133_ART_75_II_LIMITE)}`,
            },
            {
              type: 'quantidade_dispensas',
              weight: 0.3,
              value: Math.min(100, n * 25),
              description: `${n} dispensas para o mesmo CNPJ nos últimos 12 meses`,
            },
            {
              type: 'janela_temporal',
              weight: 0.2,
              value: Math.max(0, 100 - diasEntrePrimeiraUltima / 3.65),
              description: `${Math.round(diasEntrePrimeiraUltima)} dias entre primeira e última dispensa`,
            },
          ]

          const scoreFracResult = await scoreRisk.execute({ factors: riskFactorsFrac })
          const riskScoreFrac = scoreFracResult.data

          const confidenceFrac = hasAllFields ? 0.9 : 0.65

          const narrativaFrac =
            `Identificamos ${n} dispensas para o fornecedor CNPJ ${cnpj} nos últimos 12 meses, ` +
            `totalizando R$ ${formatBRL(somaTotal)}, acima do limite legal de R$ ${formatBRL(LEI_14133_ART_75_II_LIMITE)} ` +
            `(Lei 14.133/2021, Art. 75, §1º). O documento aponta possível fracionamento de contrato.`

          // BUG-FSC-002 (Correção B): emissão por PADRÃO (CNPJ + janela), não por
          // gazette. O pk determinístico do Finding é derivado de
          // `evidence[0].source` (MIT-ENG-001 — `persistFinding` em
          // packages/analyzer/src/index.ts: `stableKey = gazetteKey(sourceUrl)`,
          // `pk = FINDING#{fiscalId}#{cityId}#{type}#{stableKey}`). Antes deste fix,
          // cada gazette do mesmo CNPJ usava sua própria URL como evidence[0], então
          // cada uma gerava um pk distinto e o MESMO padrão de fracionamento era
          // reemitido a cada nova dispensa (15 findings para 6 padrões reais no
          // Ciclo 4, inflação ~2,5×).
          //
          // Fix (sem alterar o esquema de pk global — apenas qual evidência vira
          // evidence[0] aqui): se já existe um finding `fracionamento` para este
          // CNPJ+cidade no histórico, reaproveita a evidência ÂNCORA dele (a
          // primeira gazette que originou o padrão) como evidence[0] do novo
          // finding. O pk resultante no analyzer é IDÊNTICO ao do finding anterior,
          // então o `saveMemory` (PUT por pk) ATUALIZA o finding existente em vez de
          // criar um novo — soma e evidência ficam com o estado mais recente, e
          // reprocessar a mesma gazette (reanalyze) continua idempotente. Sem
          // padrão anterior, a gazette atual vira a âncora para futuras
          // atualizações do mesmo padrão.
          const existingFracionamento = historico.find(
            f => f.type === 'fracionamento' && f.cityId === cityId && f.cnpj === cnpj,
          )

          const currentEvidence: Evidence = { source: gazette.url, excerpt, date: gazette.date }
          const historicoEvidence = dispensasHistorico.flatMap(f => f.evidence ?? [])
          const rawEvidenceFrac: Evidence[] = existingFracionamento
            ? [...existingFracionamento.evidence, ...historicoEvidence, currentEvidence]
            : [currentEvidence, ...historicoEvidence]

          // Dedup por `source` (URL da gazette) — evita evidence duplicada quando a
          // mesma gazette aparece tanto na âncora quanto no histórico/atual.
          const seenSources = new Set<string>()
          const evidenceFrac = rawEvidenceFrac.filter(e => {
            if (seenSources.has(e.source)) return false
            seenSources.add(e.source)
            return true
          })

          const findingFrac: Finding = {
            fiscalId: FISCAL_ID,
            cityId,
            type: 'fracionamento',
            riskScore: riskScoreFrac,
            confidence: confidenceFrac,
            evidence: evidenceFrac,
            narrative: narrativaFrac,
            legalBasis: 'Lei 14.133/2021, Art. 75, §1º',
            cnpj,
            secretaria: secretaria ?? undefined,
            value: somaTotal,
            createdAt: now.toISOString(),
          }

          findings.push(findingFrac)
        }
      }

      const dispensaPk = `DISPENSA#${gazetteKey(gazette.url) ?? gazette.id}#${cnpj ?? 'NOCNPJ'}#${valor}`

      const saveMemoryFn = context.saveMemory ?? saveMemory
      await saveMemoryFn.execute({
        pk: dispensaPk,
        table: alertsTable,
        item: dispensaItem,
      })
    }

    return findings
  },
}
