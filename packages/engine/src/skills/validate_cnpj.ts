import type { Skill, SkillResult, SupplierProfile } from '../types'

const BRASIL_API = 'https://brasilapi.com.br/api/cnpj/v1'

interface BrasilApiCNPJ {
  cnpj: string
  razao_social: string
  situacao_cadastral: number
  data_inicio_atividade: string
  qsa?: Array<{ nome_socio: string }>
}

function situacaoLabel(code: number): string {
  const labels: Record<number, string> = {
    1: 'nula', 2: 'ativa', 3: 'suspensa', 4: 'inapta', 8: 'baixada',
  }
  return labels[code] ?? 'desconhecida'
}

export interface ValidateCNPJInput {
  cnpj: string
}

export const validateCNPJ: Skill<ValidateCNPJInput, Partial<SupplierProfile>> = {
  name: 'validate_cnpj',
  description: 'Valida CNPJ na Receita Federal via BrasilAPI e retorna dados cadastrais',

  async execute(input: ValidateCNPJInput): Promise<SkillResult<Partial<SupplierProfile>>> {
    const clean = input.cnpj.replace(/\D/g, '')
    const url = `${BRASIL_API}/${clean}`

    const res = await fetch(url, { headers: { Accept: 'application/json' } })

    if (res.status === 404) {
      return {
        data: { cnpj: input.cnpj, situacaoCadastral: 'nao_encontrado' },
        source: url,
        confidence: 0.9,
      }
    }

    if (!res.ok) throw new Error(`BrasilAPI CNPJ ${res.status}: ${res.statusText}`)

    const body = await res.json() as BrasilApiCNPJ

    return {
      data: {
        cnpj: input.cnpj,
        razaoSocial: body.razao_social,
        situacaoCadastral: situacaoLabel(body.situacao_cadastral),
        dataAbertura: body.data_inicio_atividade,
        socios: body.qsa?.map(s => s.nome_socio) ?? [],
        sanctions: false,  // preenchido por check_sanctions
      },
      source: url,
      confidence: 1.0,
    }
  },
}
