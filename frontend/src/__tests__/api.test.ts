import assert from 'node:assert/strict'
import test from 'node:test'

import { cancelBooking, deleteChat, getMe, logout, register, sendChat, setAccessToken, setUnauthorizedHandler } from '../api.ts'

function mockJson(body: unknown, status = 200) {
  let captured: { path: string; init: RequestInit } | null = null
  globalThis.fetch = (async (path: string | URL | Request, init: RequestInit = {}) => {
    captured = { path: String(path), init }
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return () => captured
}

test('register sends the backend field names', async () => {
  const captured = mockJson({ data: { user: { id: 'u' }, accessToken: 'token', expiresIn: '24h' } })
  await register('Student', 'student@example.com', 'password123')
  const request = captured()
  assert.equal(request?.path, '/api/auth/register')
  assert.equal(request?.init.method, 'POST')
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    displayName: 'Student',
    email: 'student@example.com',
    password: 'password123',
  })
})

test('cancel uses PATCH and the bearer token', async () => {
  const captured = mockJson({ data: { booking: { id: 'booking' } }, meta: { alreadyCancelled: false } })
  setAccessToken('jwt-value')
  await cancelBooking('booking')
  const request = captured()
  assert.equal(request?.path, '/api/bookings/booking/cancel')
  assert.equal(request?.init.method, 'PATCH')
  assert.equal(new Headers(request?.init.headers).get('Authorization'), 'Bearer jwt-value')
})

test('chat preserves structured tool events', async () => {
  mockJson({ sessionId: 'session', requestId: 'request', message: 'Found one.', replayed: false, events: [{ tool: 'search_flights', result: { ok: true, status: 200, data: { flights: [] } } }] })
  const result = await sendChat('Find a flight', 'session', 'request')
  assert.equal(result.events[0]?.tool, 'search_flights')
})

test('logout and chat deletion send bearer authentication and accept 204', async () => {
  const calls: Array<{ path: string; method?: string; authorization: string | null }> = []
  globalThis.fetch = (async (path, init = {}) => {
    calls.push({ path: String(path), method: init.method, authorization: new Headers(init.headers).get('Authorization') })
    return new Response(null, { status: 204 })
  }) as typeof fetch
  setAccessToken('current-token')
  await deleteChat('conversation')
  await logout()
  assert.deepEqual(calls, [
    { path: '/chat-api/chat/conversation', method: 'DELETE', authorization: 'Bearer current-token' },
    { path: '/api/auth/logout', method: 'POST', authorization: 'Bearer current-token' },
  ])
})

test('expired and disabled accounts clear auth, but a stale 401 cannot clear a newer login', async () => {
  let cleared = 0
  setUnauthorizedHandler(() => cleared++)
  for (const [status, code] of [[401, 'TOKEN_REVOKED'], [403, 'ACCOUNT_NOT_ACTIVE']] as const) {
    mockJson({ error: { code, message: 'Sign in again' } }, status)
    await assert.rejects(getMe())
  }
  assert.equal(cleared, 2)
  let finish!: (response: Response) => void
  globalThis.fetch = () => new Promise<Response>((resolve) => { finish = resolve })
  const oldRequest = getMe()
  setAccessToken('new-login-token')
  finish(new Response(JSON.stringify({ error: { code: 'TOKEN_REVOKED' } }), { status: 401 }))
  await assert.rejects(oldRequest)
  assert.equal(cleared, 2)
})
