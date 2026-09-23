# Flight Booking Frontend

Vue 3 desktop-first frontend for the simulated flight booking backend and AI middle layer.

## UI stack

- Tailwind CSS 4 utilities provide all application layout, spacing, typography, and theme overrides. `src/main.ts` imports `tailwindcss/index.css` for the framework and `src/style.css` for the theme. `style.css` is the only permitted stylesheet: it carries `@import "tailwindcss"` and the `@custom-variant dark` rule that keeps the theme switchable, and neither can live in a Vue `<style>` block. Every other file uses utility classes only — no component stylesheets, no Vue style blocks, no inline styles.
- Element Plus provides forms, inputs, date pickers, selects, tables, pagination, drawers, dialogs, and descriptions. Its published component stylesheet is imported in `main.ts`.
- `lucide-vue-next` provides icons. Use its components instead of handwritten SVG or CSS-drawn icons.
- Use `ElForm` and `ElTable` for new forms and tables. `npm test` checks that source files do not introduce raw forms/tables, inline styles, or custom stylesheets.

## Local development

Start the backend on `http://localhost:3000`, then the AI middle layer on `http://127.0.0.1:8000` when chat is needed. Finally:

```powershell
npm install
npm run dev
```

Vite proxies `/api/*` to the Node backend and rewrites `/chat-api/*` to the middle layer's `/api/*` routes, so the browser uses same-origin requests.

## Checks

```powershell
npm test
npm run lint
npm run build
```

`npm test` runs the Node test runner directly against `src/__tests__/*.test.ts`. There is no test framework or bundler in the loop for the source check: Node strips the TypeScript types itself, which is why `engines` requires Node `^22.18.0` or `>=24.12.0`.

ESLint checks the source, Prettier handles formatting, and EditorConfig supplies shared indentation and line-width settings. The browser and Node TypeScript configurations remain separate because their runtime types differ.

Production hosting must preserve the same `/api` and `/chat-api` reverse-proxy paths.

## Reference design and scope

The design uses navy navigation, blue actions, white surfaces on a pale slate canvas, compact typography, and restrained borders and shadows.

The flight-search page and shared login/register panel use aviation photographs from [`public/images`]. The images are decorative JPEG assets; form controls and copy are rendered in Vue. Mobile layouts retain the photography while stacking the search and authentication forms. The dark theme uses a navy/slate palette and the same blue action color.

- Login and registration share `AuthView.vue`. Search results and AI results share `FlightTable.vue`; flight and booking details share `FlightItinerary.vue`. Element Plus drawers and dialogs handle focus and Escape behavior.
- All prices, availability, dates, and sort order come from the API. The references disagree on some data and styles; the implementation keeps USD and genuinely ascending prices, rather than copying contradictory example values.
- Password recovery and language switching are omitted until those product flows exist. Read-only profile data, fixed newest-first trips, and chat status do not pretend to expose unsupported actions or an exact server expiry time.
- Registration and login save the raw JWT in MongoDB's `users.tokens` array. Tokens expire after 24 hours, and `POST /api/auth/logout` removes only the current token. Other devices stay signed in. Remember me only changes browser persistence, not expiry.
- Airline options use `GET /api/airlines`, independent of flight pagination. Page and sort changes only refetch flight results; route/date/filter changes refresh the relevant auxiliary data.

See `../docs/api-reference.md` for the route-to-screen analysis, logout semantics, and future requirements.
