# Flight Booking Frontend

Vue 3 desktop-first frontend for the simulated flight booking backend and AI middle layer.

## UI stack

- Tailwind CSS 4 utilities provide application layout, spacing, and typography. `src/style.css` is the Tailwind entry point and defines the switchable dark palette, surface token, fonts, and shared motion. Additional shared CSS files are allowed when needed; components keep utility classes rather than Vue style blocks or inline styles.
- Element Plus provides forms, inputs, date pickers, selects, tables, pagination, drawers, dialogs, and descriptions. Its published component stylesheet is imported in `main.ts`.
- `lucide-vue-next` provides icons. Use its components instead of handwritten SVG or CSS-drawn icons.
- Use `ElForm` and `ElTable` for new forms and tables. `npm test` checks that Vue source files do not introduce raw forms/tables, handwritten SVG, inline styles, or component style blocks; it does not impose a stylesheet count.

## Local development

Start the backend on `http://localhost:3000`, then the AI middle layer on `http://127.0.0.1:8000` when chat is needed. Finally:

```powershell
npm install
npm run dev
```

Vite proxies `/api/*` to the Node backend and rewrites `/chat-api/*` to the middle layer's `/api/*` routes, so the browser uses same-origin requests.

## Simulated checkout

Flight review and AI flight-confirmation cards open `/flights/:flightId/checkout` with the traveler count. Checkout has three stages: select one demo seat per traveler, confirm a short reservation-progress animation, and complete a simulated payment. The mobile layout keeps the primary action visible in a bottom bar.

The seat map is an illustrative 3–3 layout capped at 20 rows. Selected seat labels remain local to this screen; the backend only stores seat counts, so no actual seat assignment or inventory hold is made during the animation. No card details are requested and no money is charged.

Only the final payment button calls `POST /api/bookings`. It reuses the existing booking idempotency key after errors or refreshes, prevents concurrent submissions, and keeps errors on the payment screen. Leaving before payment creates no booking. Success opens My trips, where a separately fetched, owner-scoped booking supplies the confirmation receipt. Natural-language AI tool bookings still use the existing backend tool flow.

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

Inter is used for body text and Manrope for headings, with system-font fallbacks. Short entrance and route fades respect reduced-motion preferences. Card backgrounds use `bg-surface`, which changes with the theme; `white` retains its literal meaning for readable text and translucent highlights on dark navigation and hero backgrounds. Mobile navigation occupies its own row.

The flight-search page and shared login/register panel use aviation photographs from [`public/images`]. The images are decorative JPEG assets; form controls and copy are rendered in Vue. Mobile layouts retain the photography while stacking the search and authentication forms. The dark theme uses a navy/slate palette and the same blue action color.

- Login and registration share `AuthView.vue`. Search results and AI results share `FlightTable.vue`; flight and booking details share `FlightItinerary.vue`. Element Plus drawers and dialogs handle focus and Escape behavior.
- All prices, availability, dates, and sort order come from the API. The references disagree on some data and styles; the implementation keeps USD and genuinely ascending prices, rather than copying contradictory example values.
- Password recovery and language switching are omitted until those product flows exist. Read-only profile data, fixed newest-first trips, and chat status do not pretend to expose unsupported actions or an exact server expiry time.
- Registration and login save the raw JWT in MongoDB's `users.tokens` array. Tokens expire after 24 hours, and `POST /api/auth/logout` removes only the current token. Other devices stay signed in. Remember me only changes browser persistence, not expiry.
- Airline options use `GET /api/airlines`, independent of flight pagination. Page and sort changes only refetch flight results; route/date/filter changes refresh the relevant auxiliary data.

See `../docs/api-reference.md` for the route-to-screen analysis, logout semantics, and future requirements.
