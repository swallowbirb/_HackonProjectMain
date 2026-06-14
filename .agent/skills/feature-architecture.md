# Feature Architecture

Every new feature should be isolated.

Frontend:

features/
└── reviews/
    ├── components/
    ├── hooks/
    ├── services/
    └── pages/

Backend:

modules/
└── reviews/
    ├── review.routes.js
    ├── review.controller.js
    ├── review.service.js
    ├── review.model.js
    └── review.validation.js

Keep feature code together.

Avoid spreading feature logic across unrelated folders.

Prefer feature ownership over file-type ownership.