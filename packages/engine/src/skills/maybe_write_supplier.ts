import { docClient } from '../utils/dynamodb'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { isValidCNPJ } from '../regex'
import { isFeatureEnabled } from '../feature-flags'
import { createLogger } from '../logger'
import type { Skill, SkillResult } from '../types'

/**
 * maybe_write_supplier — Write-path de `fiscal-digital-suppliers-prod` (EVO-005).
 *
 * A tabela existe desde EVO-002 (PR #131) mas está VAZIA: os dois leitores
 * abaixo enxergam zero registros e ficam apagados em prod.
 *
 *   - `skills/query_suppliers_contract.ts` — FiscalContratos, % de aditivo sobre
 *     o valor original (ADR-001: 89% de FP sem esse cross-reference).
 *   - `fiscais/fornecedores-v2.ts` → `queryConcentracaoGSI2()` — concentração
 *     por secretaria em 12 meses via `GSI2_ConcentracaoSecretaria`.
 *
 * Schema (terraform/modules/dynamodb/main.tf):
 *   pk = SUPPLIER#{cnpj}
 *   sk = {contractedAt YYYY-MM-DD}#{contractId}
 *   GSI1-city-date:              hash=cityId       range=contractedAt
 *   GSI2_ConcentracaoSecretaria: hash=secretariaId range=mesCNPJ (`YYYY-MM#CNPJ14`)
 *
 * ## Idempotência
 * `PutCommand` por (pk, sk) sobrescreve — reanálise da mesma gazette não
 * duplica o contrato no GSI2 (a agregação de `mesCNPJ` soma por item distinto).
 * A chave é derivada do contrato (`contractedAt` + `contractId`), nunca de um
 * timestamp de execução — dois runs do mesmo contrato colidem de propósito.
 *
 * ## Deploy dark
 * Guardado por `isFeatureEnabled('enable-supplier-write')` (SSM, default
 * `false`). Flag OFF ⇒ no-op silencioso: nenhum `PutCommand`, nenhum log.
 * A checagem da flag vem ANTES do gate de qualidade justamente para não
 * poluir o CloudWatch com skips enquanto a feature está desligada.
 *
 * ## Erros
 * Erros do DynamoDB propagam. O caller decide a política (o analyzer, por
 * exemplo, é best-effort: falha de write não pode derrubar o finding).
 * A fiação no pipeline é outro slice — este PR entrega só a skill.
 */

const TABLE_DEFAULT = 'fiscal-digital-suppliers-prod'
const FEATURE_FLAG = 'enable-supplier-write'

const logger = createLogger('maybe-write-supplier')

export interface MaybeWriteSupplierInput {
  /** CNPJ do fornecedor — com ou sem máscara, numérico ou alfanumérico. */
  cnpj: string
  /** Código IBGE da cidade — hash key do GSI1-city-date. */
  cityId: string
  /** Número do contrato (ex.: `388/2020`) — filtro client-side do leitor. */
  contractNumber: string
  /** Data de assinatura do contrato, `YYYY-MM-DD` — range key do GSI1. */
  contractedAt: string
  /** Valor ORIGINAL do contrato em reais. Base do cálculo de aditivo%. */
  valueAmount: number
  /** Secretaria contratante — hash key do GSI2 (`secretariaId`). */
  secretaria: string
  /** Identificador do contrato no sk. Default: `contractNumber` normalizado. */
  contractId?: string
  contractType?: string
  sourceFindingId?: string
  table?: string
}

/** Motivo do skip — `null` quando o registro foi gravado. */
export type MaybeWriteSupplierSkipReason =
  | 'feature_flag_off'
  | 'cnpj_invalido'
  | 'city_ausente'
  | 'contract_number_ausente'
  | 'contracted_at_invalido'
  | 'value_amount_invalido'
  | 'secretaria_ausente'

export interface MaybeWriteSupplierResult {
  written: boolean
  skipReason: MaybeWriteSupplierSkipReason | null
  pk?: string
  sk?: string
}

/**
 * Normalização de CNPJ — DEVE permanecer byte-a-byte idêntica à
 * `normalizeCnpj` de `query_suppliers_contract.ts`: qualquer divergência faz a
 * pk gravada não bater com a pk consultada e o leitor volta a ver `null`.
 *
 * Remove apenas `.`, `-` e `/` e aplica UPPERCASE. NUNCA usar `/\D/g`: o CNPJ
 * alfanumérico (Lei 14.973/2024) tem letras nas 12 primeiras posições e elas
 * fazem parte da chave.
 *
 * Espaço NÃO é removido — de novo, para espelhar o leitor. Entrada com espaço
 * sobra com comprimento ≠ 14 e é rejeitada pelo gate de qualidade, em vez de
 * virar uma pk silenciosamente diferente.
 */
function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/[.\-/]/g, '').toUpperCase()
}

/** Mesma normalização do leitor (`normalizeContractNumber`). */
function normalizeContractNumber(num: string): string {
  return num.trim()
}

/** `YYYY-MM-DD` real (rejeita `2026-02-31`, `2026-13-01`, timestamp ISO etc.). */
function isValidContractedAt(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return false
  // Round-trip elimina overflow de calendário (2026-02-31 → 2026-03-03).
  return parsed.toISOString().slice(0, 10) === value
}

export const maybeWriteSupplier: Skill<
  MaybeWriteSupplierInput,
  MaybeWriteSupplierResult
> = {
  name: 'maybe_write_supplier',
  description:
    'Grava (idempotentemente) um contrato de fornecedor em fiscal-digital-suppliers-prod, ' +
    'alimentando GSI1-city-date e GSI2_ConcentracaoSecretaria. Guardada pela feature flag ' +
    'enable-supplier-write (no-op quando OFF) e por um gate de qualidade de dado.',

  async execute(
    input: MaybeWriteSupplierInput,
  ): Promise<SkillResult<MaybeWriteSupplierResult>> {
    const table = input.table ?? TABLE_DEFAULT

    // ── Feature flag: OFF ⇒ no-op silencioso ─────────────────────────────────
    if (!(await isFeatureEnabled(FEATURE_FLAG))) {
      return {
        data: { written: false, skipReason: 'feature_flag_off' },
        source: `noop:feature-flag:${FEATURE_FLAG}`,
        confidence: 1.0,
      }
    }

    // ── Gate de qualidade de dado ────────────────────────────────────────────
    // Registro parcial polui o oráculo do aditivo% e o denominador da
    // concentração por secretaria. Melhor não ter o contrato do que tê-lo errado.
    const cnpj14 = normalizeCnpj(input.cnpj)
    const cityId = input.cityId?.trim() ?? ''
    const contractNumber = normalizeContractNumber(input.contractNumber ?? '')
    const contractedAt = input.contractedAt?.trim() ?? ''
    const secretariaId = input.secretaria?.trim() ?? ''
    const valueAmount = input.valueAmount

    const skip = (reason: MaybeWriteSupplierSkipReason): SkillResult<MaybeWriteSupplierResult> => {
      logger.warn('supplier write pulado — registro parcial ou inválido', {
        reason,
        cnpj: cnpj14,
        cityId,
        contractNumber,
        contractedAt,
      })
      return {
        data: { written: false, skipReason: reason },
        source: `skip:${reason}`,
        confidence: 1.0,
      }
    }

    // CNPJ com DV válido (mesmo filtro do `extractCNPJs`) E 14 caracteres já
    // normalizados — o comprimento é o que garante que a pk bate com o leitor.
    if (cnpj14.length !== 14 || !isValidCNPJ(cnpj14)) return skip('cnpj_invalido')
    // cityId é hash key do GSI1 — LRN-20260502-019: GSI key nunca vazia/null.
    if (cityId.length === 0) return skip('city_ausente')
    if (contractNumber.length === 0) return skip('contract_number_ausente')
    if (!isValidContractedAt(contractedAt)) return skip('contracted_at_invalido')
    if (typeof valueAmount !== 'number' || !Number.isFinite(valueAmount) || valueAmount <= 0) {
      return skip('value_amount_invalido')
    }
    // secretariaId é hash key do GSI2 — sem ela o item some da concentração 12m.
    if (secretariaId.length === 0) return skip('secretaria_ausente')

    // ── Chaves ───────────────────────────────────────────────────────────────
    const contractId = input.contractId?.trim() || contractNumber
    const pk = `SUPPLIER#${cnpj14}`
    const sk = `${contractedAt}#${contractId}`
    const mesCNPJ = `${contractedAt.slice(0, 7)}#${cnpj14}`

    await docClient.send(
      new PutCommand({
        TableName: table,
        Item: {
          pk,
          sk,
          // Lido por `querySuppliersContract` (cnpj/cityId/contractNumber/
          // contractedAt/valueAmount/secretaria) e por `queryConcentracaoGSI2`
          // (cnpj14/mesCNPJ/valueAmount/contractedAt).
          cnpj: cnpj14,
          cnpj14,
          cityId,
          contractId,
          contractNumber,
          contractedAt,
          valueAmount,
          secretaria: secretariaId,
          secretariaId,
          mesCNPJ,
          // LRN-20260502-019: campo de GSI key nunca `null` — opcionais são
          // omitidos com spread condicional, nunca gravados como null.
          ...(input.contractType && { contractType: input.contractType }),
          ...(input.sourceFindingId && { sourceFindingId: input.sourceFindingId }),
        },
      }),
    )

    logger.info('supplier gravado', { pk, sk, cityId, secretariaId, valueAmount })

    return {
      data: { written: true, skipReason: null, pk, sk },
      source: `dynamodb:${table}#${pk}#${sk}`,
      confidence: 1.0,
    }
  },
}
