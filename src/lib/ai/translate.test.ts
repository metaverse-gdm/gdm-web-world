import { expect, it, vi } from 'vitest'
import type { ChatMessage } from '@tik-choco/mistai'
import { LIMITS } from '../wires'
import { translateProjectText } from './translate'

const source = { title: '作品', summary: '概要', description: '# 見出し\n[URL](https://example.com)\n`code`' }
const result = { title: ' Project ', summary: ' Summary ', description: '# Heading\n[URL](https://example.com)\n`code`' }

it('asks for a natural translation into Simplified Chinese and sends only the project text as JSON', async () => {
  const request = vi.fn<(messages: ChatMessage[]) => Promise<string>>().mockResolvedValue(JSON.stringify(result))
  await translateProjectText(source, 'ja', 'zh', request)
  const [system, user] = request.mock.calls[0][0]
  expect(system.role).toBe('system')
  for (const phrase of ['Japanese', 'Simplified Chinese', 'Markdown', 'URLs', 'code', 'product names', 'proper nouns', 'ONLY a JSON object']) {
    expect(system.content).toContain(phrase)
  }
  expect(user).toEqual({ role: 'user', content: JSON.stringify(source) })
  expect(request).toHaveBeenCalledTimes(1)
})

it('parses fenced and wrapped JSON without trimming the Markdown description', async () => {
  const response = '```json\n' + JSON.stringify(result) + '\n```'
  const expected = { ...result, title: 'Project', summary: 'Summary' }
  expect(await translateProjectText(source, 'ja', 'en', async () => response)).toEqual(expected)
  expect(await translateProjectText(source, 'ja', 'en', async () => 'Result:\n' + response)).toEqual(expected)
})

it('clamps the fields using the wire limits, without splitting surrogate pairs', async () => {
  const long = { title: 'a'.repeat(LIMITS.title - 1) + '🎮', summary: 'b'.repeat(LIMITS.summary + 1), description: 'c'.repeat(LIMITS.description + 1) }
  const text = await translateProjectText(source, 'ja', 'en', async () => JSON.stringify(long))
  expect(text.title).toBe('a'.repeat(LIMITS.title - 1))
  expect(text.summary).toHaveLength(LIMITS.summary)
  expect(text.description).toHaveLength(LIMITS.description)
})

it.each(['not JSON', '{broken}', '{"title":"title","summary":42,"description":""}', '{"title":"title","summary":"summary"}'])('rejects invalid output: %s', async output => {
  await expect(translateProjectText(source, 'ja', 'en', async () => output)).rejects.toThrow()
})

it('does not request or invent a separate translation for an empty description', async () => {
  const request = vi.fn(async () => JSON.stringify(result))
  expect(await translateProjectText({ ...source, description: '' }, 'ja', 'en', request)).toEqual({ title: 'Project', summary: 'Summary', description: '' })
  expect(request).toHaveBeenCalledTimes(1)
})
