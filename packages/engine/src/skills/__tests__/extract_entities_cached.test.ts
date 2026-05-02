jest.mock('../extract_entities', () => ({
  extractEntities: { name: 'extract_entities', description: 'mock', execute: jest.fn() },
}))

jest.mock('../lookup_memory', () => ({
  lookupMemory: { name: 'lookup_memory', description: 'mock', execute: jest.fn() },
}))

jest.mock('../save_memory', () => ({
  saveMemory: {
    name: 'save_memory',
    description: 'mock',
    execute: jest.fn().mockResolvedValue({ data: null, source: '', confidence: 1 }),
  },
}))

import { createCachedExtractEntities } from '../extract_entities_cached'
import { extractEntities } from '../extract_entities'
import { lookupMemory } from '../lookup_memory'
import { saveMemory } from '../save_memory'

const mockExtractExecute = extractEntities.execute as jest.Mock
const mockLookupExecute = lookupMemory.execute as jest.Mock
const mockSaveExecute = saveMemory.execute as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockSaveExecute.mockResolvedValue({ data: null, source: '', confidence: 1 })
})

const sampleEntities = {
  cnpjs: ['12.345.678/0001-90'],
  values: [80000],
  dates: ['2026-01-15'],
  contractNumbers: ['2026/001'],
  secretaria: 'Secretaria de Obras',
  actType: 'dispensa' as const,
  supplier: 'ABC LTDA',
  legalBasis: 'Lei 14.133/2021, Art. 75',
  subtype: 'obra_engenharia' as const,
}

describe('createCachedExtractEntities', () => {
  it('memory cache: 2ª chamada com mesmo texto não chama Bedrock nem DynamoDB', async () => {
    const skill = createCachedExtractEntities({ gazetteId: 'gz-001' })
    mockLookupExecute.mockResolvedValue({ data: null, source: '', confidence: 1 })
    mockExtractExecute.mockResolvedValue({ data: sampleEntities, source: 'url', confidence: 0.85 })

    await skill.execute({ text: 'mesmo texto', gazetteUrl: 'url' })
    await skill.execute({ text: 'mesmo texto', gazetteUrl: 'url' })

    expect(mockExtractExecute).toHaveBeenCalledTimes(1)
    expect(mockLookupExecute).toHaveBeenCalledTimes(1)
  })

  it('DynamoDB cache hit: lê de entities-prod sem chamar Bedrock', async () => {
    const skill = createCachedExtractEntities({ gazetteId: 'gz-002' })
    mockLookupExecute.mockResolvedValue({
      data: {
        entities: sampleEntities,
        confidence: 0.9,
        schemaVersion: 1,
        cachedAt: '2026-05-02T10:00:00Z',
      },
      source: '',
      confidence: 1,
    })

    const result = await skill.execute({ text: 'qualquer', gazetteUrl: 'url' })

    expect(result.data).toEqual(sampleEntities)
    expect(result.confidence).toBe(0.9)
    expect(mockExtractExecute).not.toHaveBeenCalled()
  })

  it('cache miss → chama Bedrock e persiste em DynamoDB', async () => {
    const skill = createCachedExtractEntities({ gazetteId: 'gz-003' })
    mockLookupExecute.mockResolvedValue({ data: null, source: '', confidence: 1 })
    mockExtractExecute.mockResolvedValue({ data: sampleEntities, source: 'url', confidence: 0.85 })

    await skill.execute({ text: 'novo texto', gazetteUrl: 'url' })

    expect(mockExtractExecute).toHaveBeenCalledTimes(1)
    expect(mockSaveExecute).toHaveBeenCalledTimes(1)
    const saveArgs = mockSaveExecute.mock.calls[0][0]
    expect(saveArgs.pk).toMatch(/^EXTRACTION#gz-003#[a-f0-9]{16}$/)
    expect(saveArgs.item.entities).toEqual(sampleEntities)
    expect(saveArgs.item.schemaVersion).toBe(1)
  })

  it('schema version mismatch: invalida cache e re-extrai', async () => {
    const skill = createCachedExtractEntities({ gazetteId: 'gz-004' })
    mockLookupExecute.mockResolvedValue({
      data: {
        entities: sampleEntities,
        confidence: 0.85,
        schemaVersion: 0,
      },
      source: '',
      confidence: 1,
    })
    mockExtractExecute.mockResolvedValue({ data: sampleEntities, source: 'url', confidence: 0.85 })

    await skill.execute({ text: 'old version', gazetteUrl: 'url' })

    expect(mockExtractExecute).toHaveBeenCalledTimes(1)
  })

  it('lookup falha: continua para Bedrock (graceful)', async () => {
    const skill = createCachedExtractEntities({ gazetteId: 'gz-005' })
    mockLookupExecute.mockRejectedValue(new Error('DynamoDB timeout'))
    mockExtractExecute.mockResolvedValue({ data: sampleEntities, source: 'url', confidence: 0.85 })

    const result = await skill.execute({ text: 'qualquer', gazetteUrl: 'url' })

    expect(result.data).toEqual(sampleEntities)
    expect(mockExtractExecute).toHaveBeenCalledTimes(1)
  })

  it('save falha: ainda retorna o resultado (best-effort)', async () => {
    const skill = createCachedExtractEntities({ gazetteId: 'gz-006' })
    mockLookupExecute.mockResolvedValue({ data: null, source: '', confidence: 1 })
    mockExtractExecute.mockResolvedValue({ data: sampleEntities, source: 'url', confidence: 0.85 })
    mockSaveExecute.mockRejectedValueOnce(new Error('throttle'))

    const result = await skill.execute({ text: 'qualquer', gazetteUrl: 'url' })

    expect(result.data).toEqual(sampleEntities)
  })

  it('PK usa md5 truncado em 16 chars', async () => {
    const skill = createCachedExtractEntities({ gazetteId: 'gz-007' })
    mockLookupExecute.mockResolvedValue({ data: null, source: '', confidence: 1 })
    mockExtractExecute.mockResolvedValue({ data: sampleEntities, source: 'url', confidence: 0.85 })

    await skill.execute({ text: 'AAA', gazetteUrl: 'url' })

    const calledPk = mockSaveExecute.mock.calls[0][0].pk as string
    const hash = calledPk.split('#').pop()!
    expect(hash).toHaveLength(16)
    expect(hash).toMatch(/^[a-f0-9]+$/)
  })
})
