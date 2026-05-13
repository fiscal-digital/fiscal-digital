import { docClient } from '../utils/dynamodb'
import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { Skill, SkillResult } from '../types'

/**
 * query_suppliers_contract — Consulta contrato original em `fiscal-digital-suppliers-prod`.
 *
 * Resolve o gap central do FiscalContratos: calcular % de aditivo sem valor
 * original. ADR-001 (`fiscal-digital-evaluations/analyses/fiscal-contratos/`)
 * apontou 89% de FP exatamente por essa falta de cross-reference.
 *
 * Schema da tabela (terraform/modules/dynamodb/main.tf):
 *   pk = SUPPLIER#{cnpj}
 *   sk = {contractedAt YYYY-MM-DD}#{contractId}
 *   GSI1-city-date: hash_key=cityId, range_key=contractedAt
 *
 * A query é feita pela pk SUPPLIER#{cnpj} (cardinalidade baixa por CNPJ — um
 * fornecedor tem dezenas de contratos no máximo) e filtra contractId no client.
 * Mais barato que GSI1 que varreria toda a cidade.
 *
 * Retorna o registro mais recente em caso de múltiplos hits (deduplicação por
 * contractedAt descendente).
 */

export interface QuerySuppliersContractInput {
  cnpj: string
  cityId: string
  contractNumber: string
  table?: string
}

export interface SupplierContractRecord {
  cnpj: string
  cityId: string
  contractNumber: string
  contractedAt: string  // YYYY-MM-DD
  valueAmount: number
  secretaria?: string
  contractType?: string
  sourceFindingId?: string
}

const TABLE_DEFAULT = 'fiscal-digital-suppliers-prod'

function normalizeCnpj(cnpj: string): string {
  return cnpj.replace(/[.\-/]/g, '')
}

function normalizeContractNumber(num: string): string {
  return num.trim()
}

export const querySuppliersContract: Skill<
  QuerySuppliersContractInput,
  SupplierContractRecord | null
> = {
  name: 'query_suppliers_contract',
  description:
    'Consulta o contrato original em fiscal-digital-suppliers-prod por (cnpj, cityId, contractNumber). ' +
    'Retorna o valor original e a data de assinatura — usado pelo FiscalContratos para calcular % de aditivo.',

  async execute(
    input: QuerySuppliersContractInput,
  ): Promise<SkillResult<SupplierContractRecord | null>> {
    const cnpjN = normalizeCnpj(input.cnpj)
    const contractNumberN = normalizeContractNumber(input.contractNumber)
    const table = input.table ?? TABLE_DEFAULT

    const res = await docClient.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':pk': `SUPPLIER#${cnpjN}`,
        },
        ScanIndexForward: false, // mais recente primeiro
      }),
    )

    const items = (res.Items as Array<Record<string, unknown>>) ?? []

    // Filtra contractNumber + cityId no client (cardinalidade baixa por CNPJ).
    const match = items.find(item => {
      const itemContract = String(item.contractNumber ?? '').trim()
      const itemCity = String(item.cityId ?? '')
      return itemContract === contractNumberN && itemCity === input.cityId
    })

    if (!match) {
      return {
        data: null,
        source: `dynamodb:${table}#SUPPLIER#${cnpjN}`,
        confidence: 1.0,
      }
    }

    const valueAmount = typeof match.valueAmount === 'number' ? match.valueAmount : Number(match.valueAmount)

    if (!Number.isFinite(valueAmount) || valueAmount <= 0) {
      // Registro inválido (sem valor) — tratar como "não encontrado".
      return {
        data: null,
        source: `dynamodb:${table}#SUPPLIER#${cnpjN}`,
        confidence: 0.5,
      }
    }

    const record: SupplierContractRecord = {
      cnpj: cnpjN,
      cityId: input.cityId,
      contractNumber: contractNumberN,
      contractedAt: String(match.contractedAt ?? ''),
      valueAmount,
    }
    if (match.secretaria) record.secretaria = String(match.secretaria)
    if (match.contractType) record.contractType = String(match.contractType)
    if (match.sourceFindingId) record.sourceFindingId = String(match.sourceFindingId)

    return {
      data: record,
      source: `dynamodb:${table}#SUPPLIER#${cnpjN}#${record.contractedAt}#${contractNumberN}`,
      confidence: 1.0,
    }
  },
}
