import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

// style.css is the Tailwind entry point. `@import "tailwindcss"` and
// `@custom-variant dark` cannot live in a Vue <style> block, so making the
// `dark:` variant follow a `.dark` class requires exactly one stylesheet.
const allowedStylesheets = ['style.css']

test('UI uses component forms/tables/icons without custom stylesheets', () => {
  const root = new URL('../', import.meta.url)
  const files = readdirSync(root, { recursive: true }).map(String)
  assert.deepEqual(
    files
      .map((file) => file.replaceAll('\\', '/'))
      .filter((file) => /\.(css|scss|sass|less)$/.test(file)),
    allowedStylesheets,
  )
  for (const file of files.filter((file) => file.endsWith('.vue'))) {
    const source = readFileSync(new URL(file.replaceAll('\\', '/'), root), 'utf8')
    assert.doesNotMatch(
      source,
      /<(?:svg|path|circle|table|thead|tbody|tr|td|th|form|input|select|textarea|style)(?:\s|>)/i,
      file,
    )
    assert.doesNotMatch(source, /\s:?style\s*=/, file)
  }
})
