import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { setAccessToken, setUnauthorizedHandler } from '../api.ts'
import { useChatStore } from '../stores/chat.ts'
import type { ChatSession, ChatTurn } from '../types.ts'

const date = '2026-09-22T10:00:00.000Z'
const events = [
  {
    tool: 'search_airports' as const,
    result: {
      ok: true,
      status: 200,
      data: { airports: [{ id: 'airport', iataCode: 'PEK', name: 'Beijing' }] },
    },
  },
]
const savedTurn = (status: ChatTurn['status'] = 'completed'): ChatTurn => ({
  turnId: crypto.randomUUID(),
  sequence: 1,
  status,
  error: status === 'failed' ? 'Provider stopped' : null,
  view: {
    userMessage: 'Find Beijing airports',
    assistantMessage: status === 'completed' ? 'Choose an airport.' : null,
    events,
  },
})
function session(id: string, turns = [savedTurn()]): ChatSession {
  return {
    sessionId: id,
    title: `Conversation ${id}`,
    createdAt: date,
    updatedAt: date,
    lastAccess: date,
    turns,
  }
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

class Server {
  sessions = new Map<string, ChatSession>()
  posts: Array<{ sessionId: string; requestId: string; message: string }> = []
  mode = 'ok'
  listFails = false
  deleteFails = false
  fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input)
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-token')
    if (path === '/chat-api/chat/sessions') {
      if (this.listFails) return json({ detail: { message: 'List unavailable' } }, 503)
      return json({
        data: {
          sessions: [...this.sessions.values()].map((item) => ({
            sessionId: item.sessionId,
            title: item.title,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            lastAccess: item.lastAccess,
          })),
        },
      })
    }
    if (path.startsWith('/chat-api/chat/sessions/')) {
      const item = this.sessions.get(decodeURIComponent(path.split('/').at(-1)!))
      return item
        ? json({ data: { session: item } })
        : json({ detail: { code: 'SESSION_NOT_FOUND', message: 'Not found' } }, 404)
    }
    if (init.method === 'DELETE') {
      if (this.deleteFails) return json({ detail: { message: 'Deletion failed' } }, 503)
      this.sessions.delete(path.split('/').at(-1)!)
      return new Response(null, { status: 204 })
    }
    assert.equal(path, '/chat-api/chat')
    const body = JSON.parse(String(init.body))
    this.posts.push(body)
    if (this.mode === 'offline') throw new TypeError('Network offline')
    const item = this.sessions.get(body.sessionId) ?? session(body.sessionId, [])
    item.title = body.message
    const turn: ChatTurn = {
      ...savedTurn(this.mode === 'failed' ? 'failed' : 'completed'),
      turnId: body.requestId,
      sequence: item.turns.length + 1,
    }
    turn.view.userMessage = body.message
    const index = item.turns.findIndex((old) => old.turnId === turn.turnId)
    if (index >= 0) item.turns[index] = turn
    else item.turns.push(turn)
    this.sessions.set(item.sessionId, item)
    if (this.mode === 'lost') throw new TypeError('Acknowledgement lost')
    if (this.mode === 'failed')
      return json({ detail: { code: 'AI_RESPONSE_ERROR', message: 'Provider stopped' } }, 502)
    return json({
      sessionId: item.sessionId,
      requestId: turn.turnId,
      message: turn.view.assistantMessage,
      events,
      replayed: false,
    })
  }
}

let server: Server
beforeEach(() => {
  setActivePinia(createPinia())
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  })
  setAccessToken('test-token')
  setUnauthorizedHandler(() => useChatStore().clearAll())
  server = new Server()
  globalThis.fetch = server.fetch
})

test('load current-user summaries and restore ordered Turn.view text and cards', async () => {
  const first = savedTurn()
  const second = { ...savedTurn('failed'), sequence: 9 }
  server.sessions.set('a', session('a', [first, second]))
  server.sessions.set('b', session('b'))
  sessionStorage.setItem('flight-booking-chat', '[{"title":"Wrong account"}]')
  const chat = useChatStore()
  await chat.initialize()
  assert.equal(chat.conversations.length, 2)
  assert.equal(chat.currentId, 'a')
  assert.deepEqual(
    chat.current?.turns.map((turn) => turn.sequence),
    [1, 9],
  )
  assert.deepEqual(chat.current?.turns[0]?.view, first.view)
  assert.equal(chat.canRetry(first.turnId), false)
  assert.equal(chat.canRetry(second.turnId), true)
})

test('sending saves via the middle layer and a fresh store restores without a local transcript', async () => {
  const chat = useChatStore()
  await chat.initialize()
  const id = chat.currentId
  chat.createConversation()
  assert.equal(chat.currentId, id, 'Reuse an empty draft')
  await chat.send('Search for two seats')
  assert.equal(server.posts.length, 1)
  assert.equal(chat.current?.persisted, true)
  assert.equal(chat.current?.turns[0]?.status, 'completed')
  assert.deepEqual(chat.current?.turns[0]?.view.events, events)
  assert.equal(sessionStorage.getItem('flight-booking-chat'), null)
  setActivePinia(createPinia())
  const restored = useChatStore()
  await restored.initialize()
  assert.equal(restored.currentId, id)
  assert.equal(restored.current?.turns[0]?.view.userMessage, 'Search for two seats')
  assert.equal(restored.current?.turns[0]?.view.assistantMessage, 'Choose an airport.')
})

test('latest failed turn retries with its original requestId and restores partial cards', async () => {
  const failed = savedTurn('failed')
  server.sessions.set('a', session('a', [failed]))
  const chat = useChatStore()
  await chat.initialize()
  assert.deepEqual(chat.current?.turns[0]?.view.events, events)
  await chat.retry(failed.turnId)
  assert.equal(server.posts[0]?.requestId, failed.turnId)
  assert.equal(chat.current?.turns.length, 1)
  assert.equal(chat.current?.turns[0]?.status, 'completed')
})

test('a saved pending turn prevents fresh sends and unsafe retry but can be refreshed', async () => {
  const pending = savedTurn('pending')
  server.sessions.set('a', session('a', [pending]))
  const chat = useChatStore()
  await chat.initialize()
  assert.equal(chat.canSend, false)
  assert.equal(chat.canRetry(pending.turnId), false)
  await chat.send('Do it again')
  await chat.retry(pending.turnId)
  assert.equal(server.posts.length, 0)
  pending.status = 'completed'
  pending.view.assistantMessage = 'Saved elsewhere'
  await chat.initialize()
  assert.equal(chat.canSend, true)
  assert.equal(chat.current?.turns[0]?.view.assistantMessage, 'Saved elsewhere')
})

test('a lost send acknowledgement reloads the committed reply without duplicating a turn', async () => {
  server.mode = 'lost'
  const chat = useChatStore()
  await chat.initialize()
  await chat.send('Find airports')
  assert.equal(chat.current?.turns.length, 1)
  assert.equal(chat.current?.turns[0]?.status, 'completed')
  assert.equal(chat.current?.turns[0]?.delivery, undefined)
  assert.equal(chat.canSend, true)
})

test('an unsaved request keeps its ID for retry and cannot be bypassed by a new message', async () => {
  server.mode = 'offline'
  const chat = useChatStore()
  await chat.initialize()
  await chat.send('Find airports')
  const turn = chat.current!.turns[0]!
  assert.equal(chat.canSend, false)
  assert.equal(chat.canRetry(turn.turnId), true)
  server.mode = 'ok'
  await chat.retry(turn.turnId)
  assert.equal(server.posts.length, 2)
  assert.equal(server.posts[0]?.requestId, server.posts[1]?.requestId)
  assert.equal(chat.current?.turns.length, 1)
})

test('HTTP failure reloads the stored failed Turn and retains card data', async () => {
  server.mode = 'failed'
  const chat = useChatStore()
  await chat.initialize()
  await chat.send('Find airports')
  assert.equal(chat.current?.turns[0]?.status, 'failed')
  assert.equal(chat.current?.turns[0]?.error, 'Provider stopped')
  assert.deepEqual(chat.current?.turns[0]?.view.events, events)
  assert.equal(chat.canRetry(chat.current!.turns[0]!.turnId), true)
})

test('switching conversations ignores an older detail response even when fetch ignores abort', async () => {
  server.sessions.set('a', session('a'))
  server.sessions.set('b', session('b'))
  const chat = useChatStore()
  await chat.initialize()
  const old = deferred<Response>()
  globalThis.fetch = (path, init) =>
    String(path).endsWith('/sessions/a') ? old.promise : server.fetch(path, init)
  const loadingA = chat.select('a')
  await chat.select('b')
  old.resolve(json({ data: { session: session('a') } }))
  await loadingA
  assert.equal(chat.currentId, 'b')
  assert.equal(chat.current?.title, 'Conversation b')
  assert.equal(chat.loadingHistory, false)
})

test('sign-out invalidates in-flight reads and sends so they cannot repopulate a different account', async () => {
  const chat = useChatStore()
  await chat.initialize()
  const pending = deferred<Response>()
  globalThis.fetch = (path, init) =>
    String(path) === '/chat-api/chat' ? pending.promise : server.fetch(path, init)
  const sending = chat.send('Old account message')
  chat.clearAll()
  await chat.initialize()
  const nextId = chat.currentId
  pending.resolve(json({ message: 'Old reply', events, requestId: 'old', sessionId: 'old' }))
  await sending
  assert.equal(chat.currentId, nextId)
  assert.equal(chat.current?.turns.length, 0)
  assert.equal(chat.sending, false)
  const lateList = deferred<Response>()
  globalThis.fetch = () => lateList.promise
  const loading = chat.initialize()
  chat.clearAll()
  lateList.resolve(json({ data: { sessions: [session('private')] } }))
  await loading
  assert.equal(chat.conversations.length, 0)
})

test('load failure is visible and retry restores the list; deletion waits for server success', async () => {
  server.sessions.set('a', session('a'))
  server.listFails = true
  const chat = useChatStore()
  await chat.initialize()
  assert.equal(chat.listError, 'List unavailable')
  assert.equal(chat.current, null)
  server.listFails = false
  await chat.initialize()
  server.deleteFails = true
  await assert.rejects(chat.clearCurrent())
  assert.equal(chat.currentId, 'a')
  server.deleteFails = false
  await chat.clearCurrent()
  assert.equal(server.sessions.size, 0)
  assert.notEqual(chat.currentId, 'a')
  assert.equal(chat.current?.turns.length, 0)
})
