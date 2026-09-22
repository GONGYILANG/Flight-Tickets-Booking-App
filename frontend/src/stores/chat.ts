import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError, deleteChat, getChatSession, listChatSessions, sendChat } from '../api.ts'
import type { ChatConversation, ChatSession } from '../types'

export const useChatStore = defineStore('chat', () => {
  const conversations = ref<ChatConversation[]>([])
  const currentId = ref('')
  const sending = ref(false)
  const deleting = ref(false)
  const loadingSessions = ref(false)
  const loadingHistory = ref(false)
  const listError = ref('')
  const initialized = ref(false)
  const current = computed(
    () => conversations.value.find((item) => item.id === currentId.value) ?? null,
  )
  const busy = computed(() => sending.value || deleting.value)
  const canSend = computed(() =>
    Boolean(
      current.value?.loaded &&
      !current.value.loadError &&
      !busy.value &&
      !loadingSessions.value &&
      !loadingHistory.value &&
      !current.value.turns.some((turn) => turn.status === 'pending'),
    ),
  )
  let generation = 0
  let listController: AbortController | undefined
  let historyController: AbortController | undefined

  function createConversation() {
    if (busy.value || loadingSessions.value || !initialized.value) return
    historyController?.abort()
    loadingHistory.value = false
    let conversation = conversations.value.find((item) => !item.persisted && !item.turns.length)
    if (!conversation) {
      conversation = {
        id: crypto.randomUUID(),
        title: 'New conversation',
        updatedAt: Date.now(),
        turns: [],
        persisted: false,
        loaded: true,
        loadError: '',
      }
      conversations.value.unshift(conversation)
    }
    currentId.value = conversation.id
    return conversation
  }

  function applySession(conversation: ChatConversation, session: ChatSession) {
    // Preserve an unacknowledged local request so retry keeps the original requestId.
    const unconfirmed = conversation.turns.filter(
      (turn) =>
        turn.delivery === 'unconfirmed' &&
        !session.turns.some((saved) => saved.turnId === turn.turnId),
    )
    conversation.title = session.title
    conversation.updatedAt = Date.parse(session.lastAccess)
    conversation.turns = [...session.turns, ...unconfirmed]
    conversation.persisted = true
    conversation.loaded = true
    conversation.loadError = ''
  }

  async function select(id: string) {
    if (busy.value) return
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return
    currentId.value = id
    historyController?.abort()
    const controller = new AbortController()
    historyController = controller
    const scope = generation
    conversation.loadError = ''
    loadingHistory.value = conversation.persisted
    if (!conversation.persisted) return
    try {
      const session = await getChatSession(id, controller.signal)
      if (scope !== generation || controller.signal.aborted || currentId.value !== id) return
      applySession(conversation, session)
    } catch (reason) {
      if (scope !== generation || controller.signal.aborted || currentId.value !== id) return
      conversation.loadError = (reason as Error).message
    } finally {
      if (scope === generation && !controller.signal.aborted && currentId.value === id) {
        loadingHistory.value = false
      }
    }
  }

  async function loadSessions() {
    listController?.abort()
    const controller = new AbortController()
    listController = controller
    const scope = generation
    loadingSessions.value = true
    listError.value = ''
    try {
      const summaries = await listChatSessions(controller.signal)
      if (scope !== generation || controller.signal.aborted) return false
      const drafts = conversations.value.filter(
        (item) => !item.persisted && !summaries.some((summary) => summary.sessionId === item.id),
      )
      conversations.value = [
        ...drafts,
        ...summaries.map((summary) => {
          const existing = conversations.value.find((item) => item.id === summary.sessionId)
          return Object.assign(existing ?? { turns: [], loaded: false, loadError: '' }, {
            id: summary.sessionId,
            title: summary.title,
            updatedAt: Date.parse(summary.lastAccess),
            persisted: true,
          })
        }),
      ]
      initialized.value = true
      return true
    } catch (reason) {
      if (scope === generation && !controller.signal.aborted)
        listError.value = (reason as Error).message
      return false
    } finally {
      if (scope === generation && !controller.signal.aborted) loadingSessions.value = false
    }
  }

  async function initialize() {
    if (busy.value) return
    sessionStorage.removeItem('flight-booking-chat')
    sessionStorage.removeItem('flight-booking-chat-active')
    const scope = generation
    if (!(await loadSessions()) || scope !== generation) return
    const selected =
      conversations.value.find((item) => item.id === currentId.value) ?? conversations.value[0]
    if (selected) await select(selected.id)
    else createConversation()
  }

  function canRetry(turnId: string) {
    const turn = current.value?.turns.at(-1)
    return Boolean(
      turn?.turnId === turnId &&
      !busy.value &&
      !loadingHistory.value &&
      !loadingSessions.value &&
      !current.value?.loadError &&
      (turn.status === 'failed' || turn.delivery === 'unconfirmed') &&
      !current.value?.turns.some((item) => item.turnId !== turnId && item.status === 'pending'),
    )
  }

  async function send(text: string, retryRequestId?: string) {
    const conversation = current.value
    const content = text.trim()
    if (!conversation || !content || (retryRequestId ? !canRetry(retryRequestId) : !canSend.value))
      return
    const scope = generation
    const requestId = retryRequestId ?? crypto.randomUUID()
    let turn = conversation.turns.find((item) => item.turnId === requestId)
    if (turn && turn.view.userMessage !== content) return
    if (!turn) {
      turn = {
        turnId: requestId,
        status: 'pending',
        error: null,
        view: { userMessage: content, assistantMessage: null, events: [] },
      }
      conversation.turns.push(turn)
      turn = conversation.turns[conversation.turns.length - 1]!
    }
    turn.delivery = 'sending'
    turn.error = null
    if (!conversation.persisted) conversation.title = content.slice(0, 80)
    sending.value = true
    historyController?.abort()
    loadingHistory.value = false
    let saved = false
    try {
      const reply = await sendChat(content, conversation.id, requestId)
      if (scope !== generation) return
      turn.status = 'completed'
      turn.view = { userMessage: content, assistantMessage: reply.message, events: reply.events }
      delete turn.delivery
      conversation.persisted = true
      saved = true
    } catch (reason) {
      if (scope !== generation) return
      turn.status = 'pending'
      turn.delivery = 'unconfirmed'
      turn.error = (reason as Error).message
    } finally {
      if (scope === generation) {
        // A lost POST response may still have saved a completed/failed Turn.
        try {
          const session = await getChatSession(conversation.id)
          if (scope === generation) applySession(conversation, session)
        } catch (reason) {
          if (
            scope === generation &&
            !(reason instanceof ApiError && reason.status === 404 && !conversation.persisted)
          ) {
            conversation.loadError = saved
              ? 'Your reply was saved, but history could not be refreshed. Refresh the conversation.'
              : 'Unable to check the saved conversation. Refresh before sending again.'
          }
        }
        if (scope === generation) {
          // Refresh the backend title/order, keeping a draft when the start was never saved.
          await loadSessions()
          if (scope === generation) sending.value = false
        }
      }
    }
  }

  async function retry(turnId: string) {
    const turn = current.value?.turns.find((item) => item.turnId === turnId)
    if (turn && canRetry(turnId)) await send(turn.view.userMessage, turnId)
  }

  async function clearCurrent() {
    if (busy.value || loadingSessions.value || loadingHistory.value) return
    const conversation = current.value
    if (!conversation) return
    const scope = generation
    deleting.value = true
    try {
      if (conversation.persisted || conversation.turns.length) await deleteChat(conversation.id)
      if (scope !== generation) return
      conversations.value = conversations.value.filter((item) => item.id !== conversation.id)
      currentId.value = ''
    } finally {
      if (scope === generation) deleting.value = false
    }
    if (scope === generation) {
      const first = conversations.value[0]
      if (first) await select(first.id)
      else createConversation()
    }
  }

  function clearAll() {
    generation++
    listController?.abort()
    historyController?.abort()
    conversations.value = []
    currentId.value = ''
    sending.value = false
    deleting.value = false
    loadingSessions.value = false
    loadingHistory.value = false
    listError.value = ''
    initialized.value = false
    // Discard legacy browser-only histories, including those from a previous account.
    sessionStorage.removeItem('flight-booking-chat')
    sessionStorage.removeItem('flight-booking-chat-active')
  }

  return {
    conversations,
    currentId,
    current,
    sending,
    deleting,
    busy,
    canSend,
    canRetry,
    loadingSessions,
    loadingHistory,
    listError,
    initialized,
    initialize,
    createConversation,
    select,
    send,
    retry,
    clearCurrent,
    clearAll,
  }
})
