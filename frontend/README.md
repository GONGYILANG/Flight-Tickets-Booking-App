# Flight Booking Frontend

Vue 3 desktop-first frontend for the simulated flight booking backend and AI middle layer.

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

ESLint checks the source, Prettier handles formatting, and EditorConfig supplies shared indentation and line-width settings. The browser and Node TypeScript configurations remain separate because their runtime types differ.

Production hosting must preserve the same `/api` and `/chat-api` reverse-proxy paths.

## Reference design and scope

The ten reference screens live in `../../output/imagegen/flight-booking-web/`. The UI keeps their white background, navy navigation, teal actions, horizontal search, airport popover, date rail, open flight rows, filter drawer, booking review, profile, trips, cancellation dialog, and chat sidebar. Mobile layouts stack flight rows and keep tables/date rails scrollable within their own containers.

- Login and registration share `AuthView.vue`; the drawer and cancellation use native dialogs for focus, Escape, and background interaction handling.
- All prices, availability, dates, and sort order come from the API. The references disagree on some data and styles; the implementation keeps USD and genuinely ascending prices, rather than copying contradictory example values.
- Password recovery and language switching are omitted until those product flows exist. Read-only profile data, fixed newest-first trips, and chat status do not pretend to expose unsupported actions or an exact server expiry time.
- Registration and login save the raw JWT in MongoDB's `users.tokens` array. Tokens expire after 24 hours, and `POST /api/auth/logout` removes only the current token. Other devices stay signed in. Remember me only changes browser persistence, not expiry.
- Airline options use `GET /api/airlines`, independent of flight pagination. Page and sort changes only refetch flight results; route/date/filter changes refresh the relevant auxiliary data.

See `../docs/api-reference.md` for the route-to-screen analysis, logout semantics, and future requirements.
