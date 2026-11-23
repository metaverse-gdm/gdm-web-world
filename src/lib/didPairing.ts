import { formatMistaiError, MESSAGES_EN, MESSAGES_JA, MistaiError, type MistaiMessages } from '@tik-choco/mistai'
import {
  loadDelegation, parseDelegation, requestDelegation, saveDelegation, subscribeDelegation, verifyDelegation,
  type DelegationV1,
} from '@tik-choco/mistai/identity'
import { APP_ID } from '../config'
import { messages, type Language } from '../i18n'
import { CLOCK_SKEW_MS, DAY_MS, verifyDelegationSync } from './delegation'
import { createMistNode } from './mistClient'

const MESSAGES_ZH: MistaiMessages = {
  consumerPhase: {
    idle: '未连接',
    joining: '正在加入房间…',
    searching: '正在查找服务提供方…',
    connected: '已连接到服务提供方',
    error: '出错了',
  },
  consumerStep: {
    idle: '未连接',
    joining: '加入房间',
    searching: '查找服务提供方',
    connected: '已连接',
  },
  providerStatus: {
    idle: '未连接',
    connecting: '正在连接…',
    connected: '正在提供服务',
    error: '出错了',
  },
  logStatus: {
    started: '已收到',
    streaming: '正在生成',
    done: '已完成',
    error: '出错了',
  },
  ui: {
    connectionTitle: 'LLM 网络连接',
    details: '详情',
    nodeId: '节点 ID',
    peersLine: (total, consumers) => `已连接 ${total} 个节点（其中 ${consumers} 个使用方）`,
    requestLog: '请求日志',
    noRequests: '暂无请求。',
    showMore: remaining => `查看更多（还有 ${remaining} 条）`,
    charCount: count => `${count} 个字符`,
    connectedSummary: (peers, requests) => `${peers} 个节点 · ${requests} 个请求`,
  },
  errors: {
    NO_ROOM_ID: '尚未设置 LLM 网络的房间 ID。',
    JOIN_FAILED: '无法加入房间。',
    PROVIDER_NOT_FOUND: '在 LLM 网络中找不到服务提供方。',
    PROVIDER_DISCONNECTED: '与服务提供方的连接已断开。',
    REQUEST_TIMEOUT: '请求超时。',
    TTS_TEXT_TOO_LONG: '要朗读的文本太长。',
    TTS_TIMEOUT: '语音合成超时。',
    STT_TIMEOUT: '语音识别超时。',
    TTS_OUT_OF_ORDER: '收到的音频数据顺序有误。',
    TTS_AUDIO_TOO_LARGE: '收到的音频数据太大。',
    TTS_DECODE_FAILED: '无法解码音频数据。',
    REMOTE_ERROR: '服务提供方返回了错误。',
    UPSTREAM_REQUEST_FAILED: 'LLM API 请求失败。',
    UPSTREAM_HTTP_ERROR: 'LLM API 返回了错误。',
    UPSTREAM_BAD_RESPONSE: 'LLM API 响应格式有误。',
    MODEL_LIST_EMPTY: '无法获取模型列表。',
    ENDPOINT_NOT_CONFIGURED: '此服务提供方未配置该端点。',
    INVALID_PAIRING_CODE: '配对码无效。',
    PAIRING_TIMEOUT: '配对超时。',
    PAIRING_REJECTED: '配对请求被拒绝。',
    PAIRING_INVALID_DELEGATION: '收到的委托无效。',
  },
}
const mistaiMessages: Record<Language, MistaiMessages> = { ja: MESSAGES_JA, en: MESSAGES_EN, zh: MESSAGES_ZH }

function persist(delegation: DelegationV1) {
  saveDelegation(delegation)
  if (loadDelegation()?.sig !== delegation.sig) throw new DOMException('Delegation storage unavailable', 'StorageError')
}

export async function pairDidDelegation(code: string, leaf: string) {
  const delegation = await requestDelegation({ code, leaf, app: APP_ID, createNode: createMistNode })
  persist(delegation)
}

export async function importDidDelegation(json: string, leaf: string) {
  const delegation = parseDelegation(json)
  if (!delegation || !await verifyDelegation(delegation, { leaf })) {
    throw new MistaiError('PAIRING_INVALID_DELEGATION', 'Invalid delegation')
  }
  persist(delegation)
}

export function formatPairingError(error: unknown, locale: Language): string {
  if (error instanceof DOMException && error.name === 'StorageError') {
    return messages[locale].pairing.storageError
  }
  return formatMistaiError(error, mistaiMessages[locale])
}

export function createLocalPerson(leaf: string, changed: () => void) {
  let delegation: DelegationV1 | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  function update() {
    clearTimeout(timer)
    const now = Date.now()
    const stored = loadDelegation()
    delegation = verifyDelegationSync(stored, leaf, now) ? stored : undefined
    if (delegation) {
      const expiry = Date.parse(delegation.exp)
      const next = now < expiry - 7 * DAY_MS ? expiry - 7 * DAY_MS : expiry + CLOCK_SKEW_MS + 1
      timer = setTimeout(refresh, Math.min(next - now, 2_147_483_647))
    }
  }
  function refresh() {
    update()
    changed()
  }
  update()
  const unsubscribe = subscribeDelegation(refresh)
  // Refresh after a background tab resumes, including after a clock change.
  window.addEventListener('focus', refresh)
  return {
    get() {
      const now = Date.now()
      const active = delegation && now >= Date.parse(delegation.iat) - CLOCK_SKEW_MS
        && now <= Date.parse(delegation.exp) + CLOCK_SKEW_MS ? delegation : undefined
      return { id: active?.root ?? leaf, delegation: active, expiresSoon: !!active && Date.parse(active.exp) - now <= 7 * DAY_MS }
    },
    refresh,
    dispose() {
      clearTimeout(timer)
      unsubscribe()
      window.removeEventListener('focus', refresh)
    },
  }
}
