# Item Lifecycle State Machine

Inset diagram — include this as a callout box on the architecture diagram.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> INITIATED : buyer submits return / sell-used

    INITIATED --> AWAITING_EVIDENCE : Pass 1 form generated (Gemini)
    INITIATED --> CANCELLED

    AWAITING_EVIDENCE --> EVIDENCE_PENDING : buyer submits evidence
    EVIDENCE_PENDING --> GRADING : required-field gate passed
    GRADING --> GRADED : Pass 2 synthesis (Gemini)
    GRADING --> REJECTED : fraud / hard-reject / invalid

    GRADED --> ROUTED : routing brain decides path

    ROUTED --> IN_TRANSIT : resell / refurbish path
    ROUTED --> DONATED    : donate path
    ROUTED --> LIQUIDATED : liquidate path

    IN_TRANSIT --> LISTED
    LISTED --> SOLD
    LISTED --> LIQUIDATED : unsold / aged out

    SOLD --> [*]
    DONATED --> [*]
    LIQUIDATED --> [*]
    REJECTED --> [*]
    CANCELLED --> [*]
```

## Who owns each transition

| Transition | Module |
|---|---|
| `INITIATED → AWAITING_EVIDENCE` | `grading/` — Pass 1 form kicks off |
| `AWAITING_EVIDENCE → EVIDENCE_PENDING` | `items/` — evidence submitted |
| `EVIDENCE_PENDING → GRADING` | `grading/` — required-field gate passed |
| `GRADING → GRADED` | `grading/` — Pass 2 synthesis complete |
| `GRADING → REJECTED` | `grading/` — fraud preflight HARD signal |
| `GRADED → ROUTED` | `routing/` — disposition decision made |
| `ROUTED → IN_TRANSIT` | `routing/` — resell/refurbish path chosen |
| `ROUTED → DONATED / LIQUIDATED` | `routing/` — alt paths |
| `IN_TRANSIT → LISTED` | `resale/` — draft listing published |
| `LISTED → SOLD` | `orders/` — buyer purchases |
