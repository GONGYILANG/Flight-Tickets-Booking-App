import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError, deleteChat, getChatSession, listChatSessions, sendChat } from '../api.ts'
import type { ChatConversation, ChatSession } from '../types'

export const useChatStore = defineStore('chat', () => {
  // Share conversation data and request state between the sidebar and chat window.
  const conversations = ref<ChatConversation[]>([])
  const currentId = ref('')
  const sending = ref(false)
  const deleting = ref(false)
  const loadingSessions = ref(false)
  const loadingHistory = ref(false)
  const listError = ref('')
  const initialized = ref(false)
  // Resolve the selected conversation from the shared list.
  const current = computed(
    () => conversations.value.find((item) => item.id === currentId.value) ?? null,
  )
  // Prevent conflicting actions while a message is being sent or a session is being deleted.
  const busy = computed(() => sending.value || deleting.value)
  // Allow new messages only after history is loaded and no turn has an unresolved outcome.
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
  // clearAll() advances this counter so responses from an earlier login are ignored.
  let generation = 0
  let listController: AbortController | undefined
  let historyController: AbortController | undefined

  function createConversation() {
    // Select an existing empty draft or create one with a new UUID.
    // This is local only; send() triggers server persistence with the first message.
    if (busy.value || loadingSessions.value || !initialized.value) return
    historyController?.abort()
    loadingHistory.value = false
    // Find an existing draft with no turns and not persisted, or create a new one.
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
    // Synchronize the title, timestamps, and ordered turns with the server response.
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
    // Switch conversations and fetch saved history; local drafts need no request.
    if (busy.value) return
    const conversation = conversations.value.find((item) => item.id === id)
    if (!conversation) return
    currentId.value = id
    historyController?.abort()
    const controller = new AbortController()
    historyController = controller
    conversation.loadError = ''
    loadingHistory.value = conversation.persisted
    if (!conversation.persisted) return
    try {
      const session = await getChatSession(id, controller.signal)
      // Ignore replies after logout, cancellation, or selection of another conversation.
      if (controller.signal.aborted || currentId.value !== id) return
      applySession(conversation, session)
    } catch (reason) {
      if (controller.signal.aborted || currentId.value !== id) return
      conversation.loadError = (reason as Error).message
    } finally {
      if (!controller.signal.aborted && currentId.value === id) {
        loadingHistory.value = false
      }
    }
  }

  async function loadSessions() {
    // Refresh sidebar summaries while preserving local drafts and already loaded turns.
    listController?.abort()
    const controller = new AbortController()
    listController = controller
    const scope = generation
    loadingSessions.value = true
    listError.value = ''
    try {
      const summaries = await listChatSessions(controller.signal)
      if (controller.signal.aborted) return false
      const drafts = conversations.value.filter(
        (item) => !item.persisted && !summaries.some((summary) => summary.sessionId === item.id),
      )
      conversations.value = [
        ...drafts,
        ...summaries.map((summary) => {
          // Reuse existing conversation objects so a summary refresh does not erase history.
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
    // Load or refresh the sidebar, then restore the selected session or open an empty draft.
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
    // Retry only the latest failed or locally unconfirmed turn when no other work blocks it.
    // A server-confirmed pending turn must be refreshed rather than executed again.
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
    // Display the outgoing message, submit it through the middle layer, then reload saved state.
    const conversation = current.value
    const content = text.trim()
    if (!conversation || !content || (retryRequestId ? !canRetry(retryRequestId) : !canSend.value))
      return
    const scope = generation
    // Reuse the original ID on retries to preserve backend idempotency.
    const requestId = retryRequestId ?? crypto.randomUUID()
    let turn = conversation.turns.find((item) => item.turnId === requestId)
    if (turn && turn.view.userMessage !== content) return
    if (!turn) {
      // Show the user's message immediately; the server will assign its sequence later.
      turn = {
        turnId: requestId,
        status: 'pending',
        error: null,
        view: { userMessage: content, assistantMessage: null, events: [] },
      }
      conversation.turns.push(turn)
      // Read through the reactive array so later mutations update the Vue interface.
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
      turn.status = 'completed'
      turn.view = { userMessage: content, assistantMessage: reply.message, events: reply.events }
      delete turn.delivery
      conversation.persisted = true
      saved = true
    } catch (reason) {
      // A failed HTTP request does not prove the server failed to save or execute this turn.
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
    // Resend the original user text and request ID through the normal send flow.
    const turn = current.value?.turns.find((item) => item.turnId === turnId)
    if (turn && canRetry(turnId)) await send(turn.view.userMessage, turnId)
  }

  async function clearCurrent() {
    // Delete the selected session before removing it locally, then open another conversation.
    // An untouched local draft can be removed without contacting the server.
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
    // Reset frontend state on logout/account changes without deleting saved server sessions.
    // Cancel reads and invalidate all outstanding callbacks, including message submissions.
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
