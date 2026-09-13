<script setup lang="ts">
import { ElAlert, ElButton, ElDrawer, ElForm, ElFormItem, ElInput } from 'element-plus'
import { LoaderCircle, Menu, Send, Trash2, X } from 'lucide-vue-next'
import ConversationList from '../components/ConversationList.vue'
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
    const event = messages[index]?.events?.find(
      (item) => item.tool === 'search_flights' && item.result.ok,
    )
    const count = Number(
      (event?.result.data?.search as { passengers?: number } | undefined)?.passengers,
    )
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
  <AppShell flush>
    <section class="grid h-[calc(100dvh-4rem)] min-h-0 md:grid-cols-[280px_minmax(0,1fr)]">
      <aside class="hidden overflow-y-auto border-r border-slate-200 p-5 md:block">
        <ConversationList />
      </aside>
      <ElDrawer
        v-model="sidebarOpen"
        title="Conversations"
        direction="ltr"
        size="min(320px, 90vw)"
        :close-icon="X"
      >
        <ConversationList @selected="sidebarOpen = false"/>
      </ElDrawer>
      <div class="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <header
          class="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-5 lg:px-8"
        >
          <div>
            <div class="flex items-center gap-3">
              <ElButton
                class="md:hidden!"
                :icon="Menu"
                aria-label="Toggle conversations"
                :aria-expanded="sidebarOpen"
                @click="sidebarOpen = true"
              />
              <h1 class="text-xl font-semibold tracking-tight sm:text-2xl">AI Assistant</h1>
            </div>
            <p class="mt-2 text-xs text-slate-500">
              {{ chat.sending ? 'Waiting for assistant…' : 'Ready to chat' }}
            </p>
          </div>
          <ElButton text :icon="Trash2" :disabled="chat.sending" @click="clearSession">
            Clear session
          </ElButton>
        </header>
        <div ref="messageList" class="min-h-0 overflow-y-auto px-4 py-6 lg:px-8" aria-live="polite">
          <ElAlert
            v-if="error"
            :title="error"
            type="error"
            :closable="false"
            class="mb-4"
            role="alert"
          />
          <article
            v-for="(message, index) in chat.current?.messages"
            :key="message.id"
            class="mb-5 grid min-w-0 gap-3"
            :class="message.role === 'user' ? 'justify-items-end' : 'justify-items-start'"
          >
            <div
              class="max-w-full rounded-xl px-4 py-3 text-sm leading-6 wrap-anywhere whitespace-pre-wrap sm:max-w-[85%]"
              :class="
                message.role === 'user'
                  ? 'bg-teal-700 text-white'
                  : 'border border-slate-200 bg-slate-50 text-slate-800'
              "
            >
              {{ message.text }}
            </div>
            <ChatEventCards
              v-if="message.events?.length"
              :events="message.events"
              :passengers="passengersFor(index)"
              :interactive="message.id === latestAssistant?.id && !chat.sending"
              @quick="submit"
            />
            <ElButton
              v-if="message.failed"
              type="danger"
              text
              :disabled="chat.sending"
              @click="retry(message.requestId, message.text)"
            >
              {{ message.error ?? 'Message failed' }} · Retry
            </ElButton>
          </article>
          <p v-if="chat.sending" class="flex items-center gap-2 text-sm text-slate-500">
            <LoaderCircle
              :size="16"
              class="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />Assistant is working…
          </p>
        </div>
        <ElForm
          class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-slate-200 px-4 py-4 lg:px-8"
          @submit.prevent="submit()"
        >
          <ElFormItem class="mb-0! min-w-0">
            <ElInput
              v-model="input"
              maxlength="4000"
              placeholder="Type a message"
              aria-label="Message"
            />
          </ElFormItem>
          <ElButton
            type="primary"
            native-type="submit"
            :icon="Send"
            :disabled="chat.sending || !input.trim()"
          >Send
          </ElButton>
          <p class="col-span-full text-xs leading-5 text-slate-500">
            AI actions use the same availability and booking rules as the Flights page.
          </p>
        </ElForm>
      </div>
    </section>
  </AppShell>
</template>
