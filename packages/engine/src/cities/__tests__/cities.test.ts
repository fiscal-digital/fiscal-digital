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

  it('Porto Alegre (4314902) está mapeada mas inativa (Fase 2)', () => {
    const c = getCity('4314902')
    expect(c?.active).toBe(false)
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

  it('activeCities retorna apenas cidades de Fase 1', () => {
    const active = activeCities()
    expect(active).toHaveLength(1)
    expect(active[0].cityId).toBe('4305108')
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
