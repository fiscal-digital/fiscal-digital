import {
  CITIES,
  getCity,
  getCityOrFallback,
  activeCities,
} from '../index'

describe('cities', () => {
  it('Caxias do Sul (4305108) está ativa em Fase 1', () => {
    const c = getCity('4305108')
    expect(c).toBeDefined()
    expect(c?.name).toBe('Caxias do Sul')
    expect(c?.uf).toBe('RS')
    expect(c?.active).toBe(true)
  })

  it('Porto Alegre (4314902) está ativa', () => {
    const c = getCity('4314902')
    expect(c).toBeDefined()
    expect(c?.name).toBe('Porto Alegre')
    expect(c?.active).toBe(true)
  })

  it('São Paulo (3550308) está ativa', () => {
    const c = getCity('3550308')
    expect(c?.name).toBe('São Paulo')
    expect(c?.active).toBe(true)
  })

  it('Curitiba (4106902) está ativa', () => {
    const c = getCity('4106902')
    expect(c?.name).toBe('Curitiba')
    expect(c?.active).toBe(true)
  })

  it('getCity retorna undefined para IBGE desconhecido', () => {
    expect(getCity('0000000')).toBeUndefined()
  })

  it('getCityOrFallback nunca retorna undefined', () => {
    const c = getCityOrFallback('9999999')
    expect(c.cityId).toBe('9999999')
    expect(c.name).toBe('9999999')
    expect(c.active).toBe(false)
  })

  it('activeCities inclui todas as cidades ativas', () => {
    const active = activeCities()
    const ids = active.map(c => c.cityId)
    expect(ids).toContain('4305108') // Caxias do Sul
    expect(ids).toContain('4314902') // Porto Alegre
    expect(ids).toContain('3550308') // São Paulo
    expect(ids).toContain('4106902') // Curitiba
    expect(active.every(c => c.active)).toBe(true)
  })

  it('todas as cidades têm cityId IBGE de 7 dígitos numéricos', () => {
    for (const [key, city] of Object.entries(CITIES)) {
      expect(key).toMatch(/^\d{7}$/)
      expect(city.cityId).toBe(key)
    }
  })

  it('hashtag não contém o caractere #', () => {
    for (const city of Object.values(CITIES)) {
      expect(city.hashtag).not.toMatch(/^#/)
    }
  })
})
