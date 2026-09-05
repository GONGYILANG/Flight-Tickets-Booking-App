<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AppShell from '../components/AppShell.vue'
import ChatEventCards from '../components/ChatEventCards.vue'
import { useChatStore } from '../stores/chat'

const chat = useChatStore()
const input = ref('')
const messageList = ref<HTMLElement | null>(null)
const sidebarOpen = ref(false)
const error = ref('')
if (!chat.current) chat.createConversation()

const latestAssistant = computed(() => chat.current?.messages.slice(-1)[0])

function passengersFor(messageIndex: number) {
  const messages = chat.current?.messages ?? []
  for (let index = messageIndex; index >= 0; index--) {
    const event = messages[index]?.events?.find((item) => item.tool === 'search_flights' && item.result.ok)
    const count = Number((event?.result.data?.search as { passengers?: number } | undefined)?.passengers)
    if (count >= 1 && count <= 9) return count
  }
  return 1
}

async function clearSession() {
  error.value = ''
  try {
    await chat.clearCurrent()
  } catch (reason) {
    error.value = (reason as Error).message
  }
}

async function submit(value = input.value) {
  const message = value.trim()
  if (!message || chat.sending) return
  input.value = ''
  await chat.send(message)
}

async function retry(requestId: string | undefined, text: string) {
  if (requestId) await chat.send(text, requestId)
}

watch(
  () => chat.current?.messages.length,
  async () => {
    await nextTick()
    messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: 'smooth' })
  },
)
</script>

<template>
  <AppShell>
    <section class="ai-layout">
      <aside class="conversation-sidebar" :class="{ open: sidebarOpen }">
        <button class="button button--outline button--wide" type="button" :disabled="chat.sending" @click="chat.createConversation(); sidebarOpen = false">＋ New conversation</button>
        <button v-for="conversation in chat.conversations" :key="conversation.id" type="button" :class="{ selected: conversation.id === chat.currentId }" @click="chat.select(conversation.id); sidebarOpen = false">{{ conversation.title }}</button>
      </aside>
      <div class="chat-panel">
        <header class="chat-header"><div><button class="sidebar-toggle" type="button" aria-label="Toggle conversations" :aria-expanded="sidebarOpen" @click="sidebarOpen = !sidebarOpen">☰</button><h1>AI Assistant</h1><p><span></span> {{ chat.sending ? 'Waiting for assistant…' : 'Ready to chat' }}</p></div><button type="button" :disabled="chat.sending" @click="clearSession">Clear session</button></header>
        <div ref="messageList" class="messages" aria-live="polite">
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
          <article v-for="(message, index) in chat.current?.messages" :key="message.id" class="message" :class="`message--${message.role}`">
            <div class="message-bubble">{{ message.text }}</div>
            <ChatEventCards v-if="message.events?.length" :events="message.events" :passengers="passengersFor(index)" :interactive="message.id === latestAssistant?.id && !chat.sending" @quick="submit" />
            <button v-if="message.failed" class="retry-message" type="button" :disabled="chat.sending" @click="retry(message.requestId, message.text)">{{ message.error ?? 'Message failed' }} · Retry</button>
          </article>
          <p v-if="chat.sending" class="message-loading">Assistant is working…</p>
        </div>
        <form class="chat-composer" @submit.prevent="submit()"><input v-model="input" maxlength="4000" placeholder="Type a message" aria-label="Message" /><button class="button" type="submit" :disabled="chat.sending || !input.trim()">Send</button><p>AI actions use the same availability and booking rules as the Flights page.</p></form>
      </div>
    </section>
  </AppShell>
</template>
