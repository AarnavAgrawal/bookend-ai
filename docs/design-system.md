# Bookend app design system

The owner's app is an operations console: a place to see what needs attention and where the money stands on every job. It should feel like Ramp's or Stripe's own dashboards: calm, dense, table-first and consistent. The landing page at `/` has its own expressive style. None of that belongs in the app.

## Rules

- **Inter everywhere in the app.** Barlow Condensed is only for the wordmark. Don't use `font-display`, `.money`, `.ticket`, `.btn` or `Rail` in app pages: those belong to the landing page and the customer, crew and approval pages.
- **Sizes:** 14px for UI text, 13px in tables, 12px for helper text and column headers. Page titles are 20px semibold, card titles 14px semibold. No all-caps labels.
- **Numbers:** always `tabular-nums` and right-aligned in tables. Money is formatted with `money()` (cents) or `dollars()` (whole dollars) from `@/components/ui`.
- **Surfaces:** pages sit on `bg-canvas`. Content sits in `Card`s with a white background, a 1px `border-border` and an 8px radius. No shadows, except on popovers. No gradients.
- **Tables are the default** for anything with more than three items. Use the `Table` building blocks in `@/components/app/primitives`. Rows link to their detail page, and the whole row is clickable.
- **One primary action per page,** at the top right of the `PageHeader`. Everything else is a secondary or ghost button.
- **Status** is a `StatusBadge`: a coloured dot plus a label. Color never carries meaning alone.
- **Money against budget** is always a `Progress` bar: a 6px amber bar that turns red only when the card declined something. This is the one recurring visual signature.
- **Empty states** say what will appear there and offer the next action.
- **Forms** go inside a `Card`, with labels above inputs, helper text below, two columns on wide screens, and a footer row for the submit button. They never sprawl full width down the page.
- **Mobile:** tables become stacked rows below 640px. Never scroll the whole page sideways.

## Tokens (Tailwind classes)

| Role | Class | Value |
|---|---|---|
| Page background | `bg-canvas` | #F7F7F5 |
| Card background | `bg-surface` | #FFFFFF |
| Hover and table header | `bg-subtle` | #F2F1EE |
| Borders | `border-border` | #E7E5E0 |
| Text | `text-ink` | #141414 |
| Secondary text | `text-muted` | #66655F |
| Tertiary text | `text-faint` | #9A9893 |
| Accent (bars, focus) | `bg-accent` / `text-accent` | #E8A33D |
| Accent tint | `bg-accent-soft` | #FBF0DC |
| Positive | `text-success`, `bg-success-soft` | #2E7D4F, #E4F1E8 |
| Declined or error | `text-danger`, `bg-danger-soft` | #C2413A, #FBE8E6 |

Buttons: `ui-btn ui-btn-primary` (ink, white text), `ui-btn ui-btn-secondary` (white, bordered), `ui-btn ui-btn-ghost`, `ui-btn ui-btn-danger`. Add `ui-btn-sm` for compact buttons. Inputs are already styled globally.

## Building blocks (`@/components/app/primitives`)

- `PageHeader({ title, description?, crumbs?, actions? })`
- `Card({ title?, description?, actions?, children, flush? })`: `flush` removes the padding for tables.
- `Table`, `THead`, `TH`, `TBody`, `TR({ href? })`, `TD({ align? })`
- `StatusBadge({ state })` for job states, and `Badge({ tone, children })` for anything else
- `Progress({ value, max, declined? })`
- `KeyValue({ items: [{ label, value }] })` for summary sidebars
- `Tabs({ tabs: [{ href, label, count?, active }] })`, which are links, so tab state lives in the URL
- `EmptyState({ title, description?, action? })`
- `Stat` and `StatStrip` for the KPI row

The app frame is `AppShell` from `@/components/app/shell`: a sidebar, a top bar with search and "New job", and the page content. `Shell` from `@/components/ui` forwards to it.
