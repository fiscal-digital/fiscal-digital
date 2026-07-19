/**
 * Tests for extração e validação de CNPJ — EVO-024.
 *
 * Cobre suporte ao CNPJ alfanumérico (Lei 14.973/2024 / IN RFB nº 2.229/2024,
 * vigência 07/2026) mantendo compatibilidade com o CNPJ numérico legado.
 */

import { extractCNPJs, extractAll, isValidCNPJ } from '../index'

describe('extractCNPJs — numérico legado (sem regressão)', () => {
  it('captura CNPJ numérico com máscara', () => {
    const text = 'Contratada: Empresa X LTDA, CNPJ: 11.222.333/0001-81.'
    expect(extractCNPJs(text)).toEqual(['11.222.333/0001-81'])
  })

  it('captura CNPJ numérico sem máscara e normaliza com máscara', () => {
    const text = 'CNPJ 11222333000181 contratada.'
    expect(extractCNPJs(text)).toEqual(['11.222.333/0001-81'])
  })

  it('deduplica CNPJs repetidos no mesmo texto', () => {
    const text = 'CNPJ 11.222.333/0001-81 ... CNPJ 11222333000181 novamente.'
    expect(extractCNPJs(text)).toEqual(['11.222.333/0001-81'])
  })
})

// Vetor alfanumérico verificado: base "1234ABCD0001" + DV "16", calculado
// pelo algoritmo oficial (módulo 11, ASCII-48) e conferido no PR contra
// CNPJ numérico real conhecido. Mascarado: "12.34A.BCD/0001-16".
describe('extractCNPJs — alfanumérico (Lei 14.973/2024)', () => {
  it('captura CNPJ alfanumérico com máscara', () => {
    const text = 'Contratada: Empresa Nova LTDA, CNPJ: 12.34A.BCD/0001-16.'
    expect(extractCNPJs(text)).toEqual(['12.34A.BCD/0001-16'])
  })

  it('captura CNPJ alfanumérico sem máscara e normaliza com máscara + uppercase', () => {
    const text = 'CNPJ 1234abcd000116 contratada.'
    expect(extractCNPJs(text)).toEqual(['12.34A.BCD/0001-16'])
  })

  it('não quebra extração de valores/datas/contratos ao processar excerpt com CNPJ alfanumérico', () => {
    const text = 'CONTRATO n° 012/2026. Valor: R$ 48.000,00. CNPJ: 12.34A.BCD/0001-16. Data: 15/03/2026.'
    const result = extractAll(text)
    expect(result.cnpjs).toEqual(['12.34A.BCD/0001-16'])
    expect(result.values).toEqual([48000])
    expect(result.dates).toEqual(['2026-03-15'])
    expect(result.contractNumbers).toEqual(['012/2026'])
  })
})

// Revisão adversarial do PR #97: o regex alargado para alfanumérico, sem
// filtro de dígito verificador, casaria qualquer token de 14 caracteres no
// formato certo — inclusive códigos que não são CNPJ. Estes testes usam
// exatamente os exemplos levantados na revisão.
describe('extractCNPJs — falsos positivos (não-CNPJ) são descartados', () => {
  it('não extrai código de processo SEI concatenado (14 chars, checksum inválido)', () => {
    const text = 'Processo SEI23067000123 encaminhado para análise.'
    expect(extractCNPJs(text)).toEqual([])
  })

  it('não extrai número de empenho concatenado (14 chars, checksum inválido)', () => {
    const text = 'Empenho 2026NE00012345 referente ao exercício.'
    expect(extractCNPJs(text)).toEqual([])
  })

  it('não extrai substring de chassi/RENAVAM (17 chars — \\b impede match no meio do token)', () => {
    const text = 'Veículo chassi 9BWZZZ377VT004251 adquirido para a frota.'
    expect(extractCNPJs(text)).toEqual([])
  })

  it('não extrai substring de token de portaria concatenado (\\b impede match no meio do token)', () => {
    const text = 'Republicação da PORTARIASEQUENCIAL2026 por erro de digitação.'
    expect(extractCNPJs(text)).toEqual([])
  })

  it('CNPJ numérico real E código SEI adversarial no mesmo texto → só o CNPJ sai', () => {
    const text = 'Processo SEI23067000123 — Contratada CNPJ 11.222.333/0001-81 — Empenho 2026NE00012345.'
    expect(extractCNPJs(text)).toEqual(['11.222.333/0001-81'])
  })

  it('CNPJ alfanumérico real E chassi adversarial no mesmo texto → só o CNPJ sai', () => {
    const text = 'Chassi 9BWZZZ377VT004251 do veículo. CNPJ da locadora: 12.34A.BCD/0001-16.'
    expect(extractCNPJs(text)).toEqual(['12.34A.BCD/0001-16'])
  })
})

describe('isValidCNPJ — numérico legado', () => {
  it('valida CNPJ numérico correto (com máscara)', () => {
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true)
  })

  it('valida CNPJ numérico correto (sem máscara)', () => {
    expect(isValidCNPJ('11222333000181')).toBe(true)
  })

  it('rejeita CNPJ numérico com dígito verificador errado', () => {
    expect(isValidCNPJ('11.222.333/0001-80')).toBe(false)
  })

  it('rejeita CNPJ zerado', () => {
    expect(isValidCNPJ('00.000.000/0000-00')).toBe(false)
  })

  it('rejeita string com comprimento diferente de 14', () => {
    expect(isValidCNPJ('123')).toBe(false)
  })

  it('valida outro CNPJ numérico real conhecido', () => {
    // Petrobras
    expect(isValidCNPJ('33.000.167/0001-01')).toBe(true)
  })
})

describe('isValidCNPJ — alfanumérico (Lei 14.973/2024)', () => {
  it('valida CNPJ alfanumérico com DV calculado corretamente (base 1234ABCD0001 → DV 16)', () => {
    // DV calculado manualmente pelo algoritmo oficial (módulo 11, ASCII-48)
    // e conferido também contra o CNPJ numérico conhecido 11.222.333/0001-81.
    expect(isValidCNPJ('1234ABCD000116')).toBe(true)
    expect(isValidCNPJ('12.34A.BCD/0001-16')).toBe(true)
  })

  it('aceita letra minúscula na entrada (normaliza para uppercase antes de validar)', () => {
    expect(isValidCNPJ('1234abcd000116')).toBe(true)
  })

  it('rejeita CNPJ alfanumérico com dígito verificador errado', () => {
    expect(isValidCNPJ('1234ABCD000117')).toBe(false)
  })

  it('rejeita dígitos verificadores não-numéricos (DVs devem ser sempre dígitos)', () => {
    expect(isValidCNPJ('1234ABCD0001AB')).toBe(false)
  })

  it('rejeita caractere fora de [A-Z0-9] (símbolo inválido)', () => {
    expect(isValidCNPJ('1234AB#D000116')).toBe(false)
  })
})
