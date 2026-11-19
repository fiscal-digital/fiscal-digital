/**
 * notifyWebRevalidate — token via SSM Parameter Store (fiscal-digital#240) e
 * paths nos locales atuais do site (pt-br / en-us).
 */

import type { Finding } from '@fiscal-digital/engine'

const mockSmSend = jest.fn()
jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn().mockImplementation(() => ({ send: mockSmSend })),
  GetParameterCommand: jest.fn().mockImplementation((input: unknown) => input),
}))

import { notifyWebRevalidate, _resetRevalidateSecretForTests } from '../web-revalidate'

const NAME = '/fiscal-digital/prod/web-revalidate-token'
const mockFetch = jest.fn()

const finding = {
  id: 'finding-123',
  cityId: '4305108',
} as Finding

beforeEach(() => {
  _resetRevalidateSecretForTests()
  mockSmSend.mockReset().mockResolvedValue({ Parameter: { Value: 'token-do-secret' } })
  mockFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ count: 8 }) })
  global.fetch = mockFetch as unknown as typeof fetch
  process.env.WEB_REVALIDATE_PARAM_NAME = NAME
})
afterAll(() => {
  delete process.env.WEB_REVALIDATE_PARAM_NAME
})

test('revalida os paths dos locales atuais, não os /pt e /en que só redirecionam', async () => {
  await notifyWebRevalidate(finding)

  const body = JSON.parse(mockFetch.mock.calls[0][1].body)
  expect(body.paths).toEqual([
    '/pt-br',
    '/pt-br/alertas',
    '/pt-br/alertas/finding-123',
    '/pt-br/cidades/caxias-do-sul',
    '/en-us',
    '/en-us/alertas',
    '/en-us/alertas/finding-123',
    '/en-us/cidades/caxias-do-sul',
  ])
})

test('autentica com o token lido do SSM pelo nome', async () => {
  await notifyWebRevalidate(finding)

  expect(mockSmSend).toHaveBeenCalledWith({ Name: NAME, WithDecryption: true })
  expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token-do-secret')
})

test('lê o parametro uma vez por container', async () => {
  await notifyWebRevalidate(finding)
  await notifyWebRevalidate(finding)
  expect(mockSmSend).toHaveBeenCalledTimes(1)
})

test('sem nome ou com parametro ilegível, pula sem lançar', async () => {
  delete process.env.WEB_REVALIDATE_PARAM_NAME
  await expect(notifyWebRevalidate(finding)).resolves.toBeUndefined()

  _resetRevalidateSecretForTests()
  process.env.WEB_REVALIDATE_PARAM_NAME = NAME
  mockSmSend.mockRejectedValue(new Error('AccessDeniedException'))
  await expect(notifyWebRevalidate(finding)).resolves.toBeUndefined()

  expect(mockFetch).not.toHaveBeenCalled()
})

test('401 e falha de rede não propagam — revalidação é best-effort', async () => {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'unauthorized' })
  await expect(notifyWebRevalidate(finding)).resolves.toBeUndefined()

  mockFetch.mockRejectedValueOnce(new Error('aborted'))
  await expect(notifyWebRevalidate(finding)).resolves.toBeUndefined()
})
