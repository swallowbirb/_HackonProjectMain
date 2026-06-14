---
trigger: always_on
---

# Backend Rules

## Stack

- Node.js
- Express.js
- MongoDB
- Mongoose

---

## Architecture

Use feature-based architecture.

src/
├── modules/
│   ├── auth/
│   ├── users/
│   └── products/
├── middleware/
├── config/
├── utils/
├── services/
└── server.js

Each module contains:

auth/
├── auth.controller.js
├── auth.service.js
├── auth.model.js
├── auth.routes.js
└── auth.validation.js

---

## Separation of Responsibilities

Controllers:
- handle request and response
- validate incoming data
- call services

Services:
- contain business logic
- coordinate application behavior

Models:
- contain mongoose schemas only

Routes:
- define endpoints only

---

## REST API Design

Use RESTful APIs.

Examples:

GET    /api/users
GET    /api/users/:id

POST   /api/users

PATCH  /api/users/:id

DELETE /api/users/:id

Avoid:

POST /getUsers
POST /deleteUser
POST /updateProduct

Use nouns, not verbs.

---

## Database Rules

Use Mongoose.

Prefer:
- indexes when appropriate
- lean() for read-only queries
- select() to limit returned fields

Never expose:
- passwords
- tokens
- secrets

Example:

User.findById(id)
  .select("-password")
  .lean()

---

## Validation

Validate:
- body
- params
- query

Every public endpoint must validate inputs.

Never trust frontend validation.

---

## Error Handling

Use centralized error middleware.

Return:

{
  "success": false,
  "message": "Human readable message"
}

Do not expose internal stack traces.

---

## Response Format

Success:

{
  "success": true,
  "data": {}
}

Failure:

{
  "success": false,
  "message": ""
}

Use consistent formats across all endpoints.

---

## Security

Use:
- Helmet
- CORS
- Rate limiting
- Input validation

Store secrets in .env

Never hardcode:
- passwords
- API keys
- tokens

---

## Naming Conventions

Controllers:
user.controller.js

Services:
user.service.js

Models:
user.model.js

Routes:
user.routes.js

Validation:
user.validation.js

---

## Code Reuse

Before creating:

- utility
- middleware
- service
- helper

Search the codebase for an existing implementation.

Avoid duplicate logic.

---

## Modification Rules

When editing existing code:

- make the smallest necessary change
- preserve architecture
- preserve existing APIs
- avoid rewriting entire files unnecessarily

Explain breaking changes before making them.

---

## Hackathon Mode

Prioritize:

1. Working MVP
2. Simplicity
3. Reliability
4. Speed of implementation

Prefer proven libraries over custom solutions.

Avoid:
- microservices
- premature optimization
- unnecessary abstractions