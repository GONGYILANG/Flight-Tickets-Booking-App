<script setup lang="ts">
import { ElButton } from 'element-plus'
import { MessageCircle, Plus } from 'lucide-vue-next'
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
      :disabled="chat.sending"
      @click="choose()"
      >New conversation</ElButton
    >
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
        @click="choose(conversation.id)"
        ><span class="max-w-48 truncate">{{ conversation.title }}</span></ElButton
      >
    </div>
  </nav>
</template>
