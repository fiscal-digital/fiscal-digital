import type { Skill, SkillResult, SupplierProfile } from '../types'

const BRASIL_API = 'https://brasilapi.com.br/api/cnpj/v1'
const USER_AGENT = 'FiscalDigital/0.1.1 (+https://fiscaldigital.org)'

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
    // Preserva letras (CNPJ alfanumérico — Lei 14.973/2024, vigência 07/2026):
    // remove apenas máscara/espaços e uppercase. NUNCA usar /\D/g aqui — isso
    // descartaria os caracteres alfabéticos e corromperia a URL da consulta.
    const clean = input.cnpj.replace(/[.\-/\s]/g, '').toUpperCase()
    const url = `${BRASIL_API}/${clean}`
    const isAlphanumeric = /[A-Z]/.test(clean)

    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } })

    if (res.status === 404) {
      return {
        data: { cnpj: input.cnpj, situacaoCadastral: 'nao_encontrado' },
        source: url,
        confidence: 0.9,
      }
    }

    if (!res.ok) {
      // Degradação graciosa para CNPJ alfanumérico: em 19/07/2026, teste
      // empírico contra a BrasilAPI em produção mostrou que o endpoint já
      // aceita a *forma* alfanumérica na rota (retorna 404 not_found, não
      // 400 bad_request, para um CNPJ alfanumérico sintático mas
      // inexistente) — mas não há confirmação de um lookup 200
      // bem-sucedido, porque a RFB só começa a emitir CNPJ alfanumérico
      // real a partir de ~27-31/07/2026. O suporte também não está
      // formalmente fechado: BrasilAPI/BrasilAPI PR #792 (aberto em
      // 13/04/2026, ainda não mergeado nesta data) atualiza só a
      // documentação OpenAPI, e o revisor apontou que a doc está "à
      // frente da implementação" — a API delega a validação ao serviço
      // externo minhareceita.org, que segundo o autor do PR já aceita o
      // formato, mas isso não é garantido em produção pela BrasilAPI.
      // Por isso: um erro não mapeado (não 404) para CNPJ alfanumérico não
      // deve derrubar o Fiscal chamador — retorna confidence baixa + flag
      // `consultaDegradada` em vez de lançar. Para CNPJ numérico legado,
      // mantém o comportamento anterior (lança — fonte confiavelmente
      // suportada há anos).
      if (isAlphanumeric) {
        return {
          data: {
            cnpj: input.cnpj,
            situacaoCadastral: 'consulta_indisponivel',
            consultaDegradada: true,
          },
          source: url,
          confidence: 0.2,
        }
      }
      throw new Error(`BrasilAPI CNPJ ${res.status}: ${res.statusText}`)
    }

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
