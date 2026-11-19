import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { checkSanctions, createLogger } from '@fiscal-digital/engine'
import type { SanctionResult, SkillResult } from '@fiscal-digital/engine'

const logger = createLogger('analyzer:cgu')

const client = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

// Cache em escopo de módulo — vive o tempo do container Lambda.
//   undefined → ainda não tentou carregar
//   null      → não configurado ou falhou (checkSanctions segue sem chave)
//   string    → chave carregada
let cached: string | null | undefined

/**
 * Chave do Portal da Transparência (CGU) do parametro SSM `CGU_PARAM_NAME`
 * (SecureString; saiu do Secrets Manager em 2026-11-19 por custo).
 *
 * Mesmo contrato do supplier-collector (fiscal-digital-collectors,
 * collectors/supplier/src/secret.ts): o valor é a chave crua ou
 * `{ "api_key": "..." }`. Falha degrada para null — sem chave, o
 * `checkSanctions` do engine avisa e devolve "não verificado".
 */
export async function loadCguApiKey(): Promise<string | null> {
  if (cached !== undefined) return cached

  const name = process.env.CGU_PARAM_NAME
  if (!name) {
    logger.warn('CGU_PARAM_NAME ausente — sanções CEIS/CNEP não serão verificadas')
    cached = null
    return null
  }

  try {
    const res = await client.send(new GetParameterCommand({ Name: name, WithDecryption: true }))
    const raw = res.Parameter?.Value ?? ''
    let key: unknown = raw
    try {
      const parsed = JSON.parse(raw)
      key = typeof parsed === 'string' ? parsed : parsed?.api_key
    } catch {
      // Não é JSON — a própria string é a chave
    }
    cached = typeof key === 'string' && key.length > 0 ? key : null
    if (cached === null) {
      logger.warn('Parametro CGU sem api_key utilizável — sanções não serão verificadas')
    } else {
      logger.info('CGU API key carregada do SSM')
    }
  } catch (err) {
    logger.warn('Falha ao carregar parametro CGU — sanções não serão verificadas', {
      err: (err as Error).message,
    })
    cached = null
  }
  return cached
}

/**
 * `FiscalContext.checkSanctions` com a chave da CGU (fiscal-digital#239).
 * Antes disto o analyzer não injetava nada, o Fiscal caía no default sem
 * `apiKey` e `fornecedor_sancionado` era inalcançável em produção.
 */
export async function checkSanctionsWithKey(input: { cnpj: string; referenceDate?: string }): Promise<SkillResult<SanctionResult>> {
  const apiKey = await loadCguApiKey()
  return checkSanctions.execute({ ...input, ...(apiKey && { apiKey }) })
}

/** @internal — testes */
export function _resetCguCacheForTests(): void {
  cached = undefined
}
