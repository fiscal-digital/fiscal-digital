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

describe('extractCNPJs — alfanumérico (Lei 14.973/2024)', () => {
  it('captura CNPJ alfanumérico com máscara', () => {
    const text = 'Contratada: Empresa Nova LTDA, CNPJ: 12.ABC.345/01DE-35.'
    expect(extractCNPJs(text)).toEqual(['12.ABC.345/01DE-35'])
  })

  it('captura CNPJ alfanumérico sem máscara e normaliza com máscara + uppercase', () => {
    const text = 'CNPJ 12abc34501de35 contratada.'
    expect(extractCNPJs(text)).toEqual(['12.ABC.345/01DE-35'])
  })

  it('não quebra extração de valores/datas/contratos ao processar excerpt com CNPJ alfanumérico', () => {
    const text = 'CONTRATO n° 012/2026. Valor: R$ 48.000,00. CNPJ: 12.ABC.345/01DE-35. Data: 15/03/2026.'
    const result = extractAll(text)
    expect(result.cnpjs).toEqual(['12.ABC.345/01DE-35'])
    expect(result.values).toEqual([48000])
    expect(result.dates).toEqual(['2026-03-15'])
    expect(result.contractNumbers).toEqual(['012/2026'])
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
