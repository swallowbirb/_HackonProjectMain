# Express Development

When creating endpoints:

Use:

Route
→ Controller
→ Service
→ Database

Responsibilities:

Routes:

- endpoint definitions only

Controllers:

- request handling
- response handling
- validation

Services:

- business logic

Models:

- database access

Follow RESTful conventions.

Use:

- async/await
- proper status codes
- centralized error handling

Avoid:

- database queries in routes
- business logic in controllers
