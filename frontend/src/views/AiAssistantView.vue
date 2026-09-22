<script setup lang="ts">
import { ElAlert, ElButton, ElDrawer, ElForm, ElFormItem, ElInput } from 'element-plus'
import { LoaderCircle, Menu, RefreshCw, Send, Trash2, X } from 'lucide-vue-next'
import { nextTick, onMounted, ref, watch } from 'vue'
import ConversationList from '../components/ConversationList.vue'
import AppShell from '../components/AppShell.vue'
import ChatEventCards from '../components/ChatEventCards.vue'
import { useChatStore } from '../stores/chat'

const chat = useChatStore()
const input = ref('')
const messageList = ref<HTMLElement | null>(null)
const sidebarOpen = ref(false)
const error = ref('')

onMounted(() => {
  void chat.initialize()
})

function passengersFor(turnIndex: number) {
  const turns = chat.current?.turns ?? []
  for (let index = turnIndex; index >= 0; index--) {
    const event = turns[index]?.view.events.find(
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
  if (!message || !chat.canSend) return
  input.value = ''
  await chat.send(message)
}

watch(
  () => chat.currentId,
  () => {
    input.value = ''
    error.value = ''
  },
)

watch(
  [
    () => chat.currentId,
    () => chat.current?.turns.length,
    () => chat.current?.turns.at(-1)?.status,
    () => chat.loadingHistory,
    () => chat.sending,
  ],
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
        <ConversationList @selected="sidebarOpen = false" />
      </ElDrawer>
      <div class="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]">
        <header
          class="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-5 lg:px-8"
        >
          <div class="min-w-0">
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
            <p class="mt-2 truncate text-xs text-slate-500">
              {{
                chat.sending
                  ? 'Waiting for assistant…'
                  : (chat.current?.title ?? 'Your conversations')
              }}
            </p>
          </div>
          <div class="flex shrink-0 gap-1">
            <ElButton
              text
              :icon="RefreshCw"
              aria-label="Refresh conversation"
              :disabled="chat.busy || chat.loadingHistory || chat.loadingSessions"
              @click="chat.initialize()"
            />
            <ElButton
              text
              :icon="Trash2"
              aria-label="Delete conversation"
              :loading="chat.deleting"
              :disabled="!chat.current || chat.busy || chat.loadingHistory || chat.loadingSessions"
              @click="clearSession"
              ><span class="hidden sm:inline">Delete conversation</span></ElButton
            >
          </div>
        </header>
        <div
          ref="messageList"
          class="min-h-0 overflow-y-auto px-4 py-6 lg:px-8"
          aria-live="polite"
          :aria-busy="chat.loadingHistory"
        >
          <ElAlert
            v-if="error || chat.current?.loadError"
            :title="error || chat.current?.loadError"
            type="error"
            :closable="false"
            class="mb-4"
            role="alert"
          />
          <p
            v-if="chat.loadingHistory || (chat.loadingSessions && !chat.current)"
            class="flex items-center gap-2 text-sm text-slate-500"
            role="status"
          >
            <LoaderCircle
              :size="16"
              class="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Loading conversation…
          </p>
          <div
            v-else-if="chat.current?.loaded && !chat.current.turns.length"
            class="py-12 text-center"
          >
            <h2 class="text-base font-semibold">Where would you like to go?</h2>
            <p class="mt-2 text-sm text-slate-500">
              Tell me your origin, destination, and travel date.
            </p>
            <p class="mt-3 text-xs text-slate-500">
              Your conversation is saved when you send a message.
            </p>
          </div>
          <template v-if="!chat.loadingHistory">
            <article
              v-for="(turn, index) in chat.current?.turns"
              :key="turn.turnId"
              class="mb-6 grid min-w-0 gap-4"
            >
              <div class="grid justify-items-end gap-1">
                <span class="text-xs text-slate-500">You</span>
                <div
                  class="max-w-full rounded-xl bg-teal-700 px-4 py-3 text-sm leading-6 wrap-anywhere whitespace-pre-wrap text-white sm:max-w-[85%]"
                >
                  {{ turn.view.userMessage }}
                </div>
              </div>
              <div
                v-if="turn.view.assistantMessage || turn.view.events.length"
                class="grid min-w-0 justify-items-start gap-3"
              >
                <span class="text-xs text-slate-500">Assistant</span>
                <div
                  v-if="turn.view.assistantMessage"
                  class="max-w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 wrap-anywhere whitespace-pre-wrap text-slate-800 sm:max-w-[85%]"
                >
                  {{ turn.view.assistantMessage }}
                </div>
                <ChatEventCards
                  v-if="turn.view.events.length"
                  :events="turn.view.events"
                  :passengers="passengersFor(index)"
                  :interactive="
                    turn.status === 'completed' &&
                    turn.turnId === chat.current?.turns.at(-1)?.turnId &&
                    chat.canSend
                  "
                  @quick="submit"
                />
              </div>
              <p
                v-if="turn.delivery === 'sending'"
                class="flex items-center gap-2 text-sm text-slate-500"
                role="status"
              >
                <LoaderCircle
                  :size="16"
                  class="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />Assistant is working…
              </p>
              <template v-else-if="turn.status !== 'completed'">
                <ElAlert
                  :title="turn.status === 'failed' ? 'Reply failed' : 'Reply not confirmed'"
                  :description="
                    turn.error ??
                    'This turn is unfinished. Refresh to check for a saved reply. Check your trips before repeating a booking.'
                  "
                  :type="turn.status === 'failed' ? 'error' : 'warning'"
                  :closable="false"
                  role="status"
                />
                <ElButton
                  v-if="chat.canRetry(turn.turnId)"
                  class="justify-self-start"
                  text
                  type="primary"
                  @click="chat.retry(turn.turnId)"
                  >Retry message</ElButton
                >
              </template>
            </article>
          </template>
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
              :disabled="!chat.canSend"
            />
          </ElFormItem>
          <ElButton
            type="primary"
            native-type="submit"
            :icon="Send"
            :disabled="!chat.canSend || !input.trim()"
            >Send</ElButton
          >
          <p class="col-span-full text-xs leading-5 text-slate-500">
            Messages are saved to your account. AI actions use the same booking rules as the Flights
            page.
          </p>
        </ElForm>
      </div>
    </section>
  </AppShell>
</template>
