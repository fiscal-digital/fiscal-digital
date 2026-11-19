/**
 * loadCguApiKey — leitura da chave da CGU no analyzer (fiscal-digital#239).
 * Mesmo contrato do supplier-collector: string crua ou JSON { api_key }.
 */

const mockSmSend = jest.fn()
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn().mockImplementation(() => ({ send: mockSmSend })),
  GetParameterCommand: jest.fn().mockImplementation((input: unknown) => input),
}))

import { loadCguApiKey, _resetCguCacheForTests } from '../cgu-sanctions'

const NAME = '/fiscal-digital/prod/cgu'

beforeEach(() => {
  _resetCguCacheForTests()
  mockSmSend.mockReset()
  process.env.CGU_PARAM_NAME = NAME
})
afterAll(() => {
  delete process.env.CGU_PARAM_NAME
})

test('sem CGU_PARAM_NAME devolve null sem chamar o SSM', async () => {
  delete process.env.CGU_PARAM_NAME
  await expect(loadCguApiKey()).resolves.toBeNull()
  expect(mockSmSend).not.toHaveBeenCalled()
})

test('valor cru é a própria chave, lido com WithDecryption', async () => {
  mockSmSend.mockResolvedValue({ Parameter: { Value: 'chave-crua' } })
  await expect(loadCguApiKey()).resolves.toBe('chave-crua')
  expect(mockSmSend).toHaveBeenCalledWith({ Name: NAME, WithDecryption: true })
})

test('valor JSON { api_key }', async () => {
  mockSmSend.mockResolvedValue({ Parameter: { Value: '{"api_key":"chave-json"}' } })
  await expect(loadCguApiKey()).resolves.toBe('chave-json')
})

test('JSON sem api_key ou parametro vazio degradam para null', async () => {
  mockSmSend.mockResolvedValue({ Parameter: { Value: '{"outra":"x"}' } })
  await expect(loadCguApiKey()).resolves.toBeNull()

  _resetCguCacheForTests()
  mockSmSend.mockResolvedValue({ Parameter: { Value: '' } })
  await expect(loadCguApiKey()).resolves.toBeNull()
})

test('erro do SDK degrada para null em vez de derrubar o analyzer', async () => {
  mockSmSend.mockRejectedValue(new Error('AccessDeniedException'))
  await expect(loadCguApiKey()).resolves.toBeNull()
})

test('carrega uma vez por container', async () => {
  mockSmSend.mockResolvedValue({ Parameter: { Value: 'chave' } })
  await loadCguApiKey()
  await loadCguApiKey()
  expect(mockSmSend).toHaveBeenCalledTimes(1)
})
