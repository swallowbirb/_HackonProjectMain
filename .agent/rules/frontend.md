---
trigger: always_on
---

# Frontend Rules

## Stack

- React
- Vite
- React Router
- TailwindCSS
- shadcn/ui
- React Bits
- Framer Motion

---

## Design Philosophy

Build visually distinctive interfaces.

Avoid:
- generic SaaS dashboards
- default Tailwind layouts
- repetitive card grids
- template-looking pages

Aim for:
- strong visual identity
- memorable layouts
- clear hierarchy
- polished interactions
- excellent spacing

Every major page should contain at least one visually distinctive element.

---

## UI Libraries

Prefer existing solutions before creating custom components.

Priority:
1. shadcn/ui
2. React Bits
3. Custom components

Use:
- shadcn/ui for application UI and common components
- React Bits for animations, effects, loaders, backgrounds, and interactive experiences

Reuse and adapt existing components whenever possible.

---

## Motion & Interactions

Use Framer Motion when motion improves UX.

Good:
- page transitions
- hover effects
- reveal animations
- micro-interactions

Avoid:
- excessive animations
- distracting movement
- animation for decoration only

---

## Spline

Use Spline selectively for:
- hero sections
- product visualization
- interactive demonstrations

Use only when it improves the experience.

Lazy load heavy assets.

---

## Folder Structure

src/
├── pages/
├── features/
├── components/
│   ├── ui/
│   └── shared/
├── hooks/
├── services/
├── layouts/
├── lib/
└── assets/

---

## Components

Components should:
- have a single responsibility
- be reusable
- remain easy to understand

Prefer composition over large components.

Extract:
- custom hooks
- utilities
- subcomponents

when complexity grows.

---

## Data Fetching

Do not place API logic directly inside pages.

Use service files:

services/
├── auth.service.js
├── user.service.js
└── product.service.js

Pages → Services → API

---

## State Management

Use:
- local state for local concerns
- context for shared state

Avoid deep prop drilling.

Create custom hooks for reusable logic.

---

## Naming Conventions

Components:
UserCard.jsx
ProductGrid.jsx

Hooks:
useAuth.js
useProducts.js

Utilities:
formatDate.js

Variables:
camelCase

Components:
PascalCase

Constants:
UPPER_CASE

---

## Responsiveness

Design mobile-first.

Support:
- mobile
- tablet
- desktop

Responsiveness is required for completion.

---

## Accessibility

Use semantic HTML.

Support:
- keyboard navigation
- accessible labels
- proper contrast

---

## Frontend Generation Rules

Before generating a page:

1. Briefly describe the layout.
2. Explain what makes it visually distinctive.
3. Check for reusable existing components.
4. Prefer shadcn/ui and React Bits.
5. Ensure responsiveness.
6. Avoid generic template designs.

When multiple UI approaches are possible, prefer the one that creates the strongest demo impact while remaining clean and usable.