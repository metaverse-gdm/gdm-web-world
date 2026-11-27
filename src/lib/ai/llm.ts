import { formatMistaiError, MESSAGES_EN, MESSAGES_JA, streamChatCompletion } from '@tik-choco/mistai'
import type { ChatMessage } from '@tik-choco/mistai'
import { providerKind, resolveModel, roomIdFromBaseUrl } from '@tik-choco/mistai/llm-config'
import { getInitialLanguage, messages } from '../../i18n'
import { loadLocalSettings, loadSharedConfig } from './settings'

export async function requestChatCompletion(chat: ChatMessage[]): Promise<string> {
  const language = getInitialLanguage()
  const t = messages[language]
  const task = loadLocalSettings().tasks.translate
  const target = resolveModel(loadSharedConfig(), task.ref)
  if (!target) throw new Error(t.aiNotConfigured)
  try {
    if (providerKind(target) === 'room') {
      const { rooms } = await import('./network')
      return await rooms.requestRoomChat(roomIdFromBaseUrl(target.baseUrl), chat, {
        model: target.model, reasoningEffort: task.reasoningEffort,
      })
    }
    return await streamChatCompletion({ ...target, reasoningEffort: task.reasoningEffort }, chat)
  } catch (error) {
    throw new Error(formatMistaiError(error, language === 'ja' ? MESSAGES_JA : MESSAGES_EN, t.aiRequestFailed), { cause: error })
  }
}
