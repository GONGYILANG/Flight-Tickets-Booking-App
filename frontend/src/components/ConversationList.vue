<script setup lang="ts">
import { ElAlert, ElButton } from 'element-plus'
import { MessageCircle, Plus, RefreshCw } from 'lucide-vue-next'
import { useChatStore } from '../stores/chat'
const chat = useChatStore()
const emit = defineEmits<{ selected: [] }>()

function choose(id?: string) {
  if (id) chat.select(id)
  else chat.createConversation()
  emit('selected')
}
</script>

<template>
  <nav class="space-y-5" aria-label="Conversations">
    <ElButton
      class="w-full"
      :icon="Plus"
      :disabled="chat.busy || chat.loadingSessions || !chat.initialized"
      @click="choose()"
      >New conversation</ElButton
    >
    <ElButton
      class="m-0! w-full"
      text
      :icon="RefreshCw"
      :loading="chat.loadingSessions"
      :disabled="chat.busy"
      @click="chat.initialize()"
      >Refresh conversations</ElButton
    >
    <p v-if="chat.loadingSessions" class="text-xs text-slate-500" role="status">
      Loading conversations…
    </p>
    <ElAlert
      v-if="chat.listError"
      :title="chat.listError"
      type="error"
      :closable="false"
      role="alert"
    />
    <div class="grid gap-2">
      <ElButton
        v-for="conversation in chat.conversations"
        :key="conversation.id"
        text
        class="m-0! h-auto! w-full justify-start! px-3! py-3!"
        :type="conversation.id === chat.currentId ? 'primary' : 'default'"
        :bg="conversation.id === chat.currentId"
        :icon="MessageCircle"
        :aria-pressed="conversation.id === chat.currentId"
        :disabled="chat.busy || chat.loadingSessions"
        @click="choose(conversation.id)"
        ><span class="max-w-48 truncate">{{ conversation.title }}</span></ElButton
      >
    </div>
  </nav>
</template>
