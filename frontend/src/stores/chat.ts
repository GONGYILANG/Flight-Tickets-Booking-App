import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { deleteChat, sendChat } from '../api'
import type { ChatConversation, ChatMessage } from '../types'

const KEY = 'flight-booking-chat'
const ACTIVE_KEY = 'flight-booking-chat-active'
const TTL = 60 * 60 * 1000
const greeting = 'Hi! Tell me your origin, destination, and travel date.'

function loadConversations(): ChatConversation[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) ?? '[]') as ChatConversation[]
    return parsed.filter((conversation) => Date.now() - conversation.updatedAt < TTL)
  } catch {
    return []
  }
}

export const useChatStore = defineStore('chat', () => {
  const conversations = ref(loadConversations())
  const currentId = ref(sessionStorage.getItem(ACTIVE_KEY) ?? '')
  const sending = ref(false)
  const current = computed(() => conversations.value.find((item) => item.id === currentId.value) ?? null)

  function createConversation() {
    const conversation: ChatConversation = {
      id: crypto.randomUUID(),
      title: 'New conversation',
      updatedAt: Date.now(),
      messages: [{ id: crypto.randomUUID(), role: 'assistant', text: greeting }],
    }
    conversations.value.unshift(conversation)
    currentId.value = conversation.id
    return conversation
  }

  watch(
    [conversations, currentId],
    () => {
      sessionStorage.setItem(KEY, JSON.stringify(conversations.value))
      sessionStorage.setItem(ACTIVE_KEY, currentId.value)
    },
    { deep: true },
  )

  function select(id: string) {
    if (conversations.value.some((item) => item.id === id)) currentId.value = id
  }

  async function send(text: string, retryRequestId?: string) {
    const conversation = current.value
    const content = text.trim()
    if (!conversation || !content || sending.value) return

    const requestId = retryRequestId ?? crypto.randomUUID()
    let userMessage = conversation.messages.find((message) => message.requestId === requestId)
    if (!userMessage) {
      userMessage = { id: crypto.randomUUID(), role: 'user', text: content, requestId }
      conversation.messages.push(userMessage)
    }
    userMessage.failed = false
    if (conversation.title === 'New conversation') conversation.title = content.slice(0, 38)
    conversation.updatedAt = Date.now()
    sending.value = true

    try {
      const response = await sendChat(content, conversation.id, requestId)
      const existing = conversation.messages.find((message) => message.id === `${requestId}-assistant`)
      const assistant: ChatMessage = {
        id: `${requestId}-assistant`,
        role: 'assistant',
        text: response.message,
        events: response.events,
      }
      if (existing) Object.assign(existing, assistant)
      else conversation.messages.push(assistant)
      conversation.updatedAt = Date.now()
    } catch (reason) {
      userMessage.failed = true
      userMessage.error = (reason as Error).message
    } finally {
      sending.value = false
    }
  }

  async function clearCurrent() {
    if (sending.value) return
    const conversation = current.value
    if (!conversation) return
    await deleteChat(conversation.id)
    conversations.value = conversations.value.filter((item) => item.id !== conversation.id)
    if (!conversations.value[0]) createConversation()
    else currentId.value = conversations.value[0].id
  }

  function clearAll() {
    conversations.value = []
    currentId.value = ''
    sessionStorage.removeItem(KEY)
    sessionStorage.removeItem(ACTIVE_KEY)
  }

  return { conversations, currentId, current, sending, createConversation, select, send, clearCurrent, clearAll }
})
