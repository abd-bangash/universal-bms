# AI data handling

This page lists everything the system sends to an AI service, what it keeps, and how to switch it off.
It is the source for the summary shown on the AI settings screen (`/automation/ai`), and a test fails if
the list below falls behind the code (`apps/api/src/modules/ai/__tests__/data-handling-doc.spec.ts`).

## When anything is sent

Nothing is sent unless **all** of these hold at the moment of the request:

1. The workspace AI mode is not `OFF` (Release 1 offers `OFF` and `ASSIST`).
2. The AI module is switched on for the workspace.
3. AI is switched on for that conversation.
4. The daily request limit and the monthly token budget have not been reached.
5. An AI service is chosen and connected under Integrations.

If any one fails, no request is made; the attempt is written to the AI log as `DISABLED` or
`LIMIT_REACHED`, with nothing from the conversation in it.

## What is sent (the "context pack")

Every request contains these fields and no others. Each is built from the workspace's own data when the
request is made; nothing is cached at the provider by us.

| Field in the pack | What it holds | Where it comes from |
| --- | --- | --- |
| `business` | Business name, industry profile name, currency | Workspace settings |
| `style` | Tone (formal or friendly), reply language, longest reply | AI settings |
| `customerName` | The name the customer's channel shows for them | The conversation |
| `questionFlow` | The ordered questions to ask for missing details | The industry profile or the workspace's own flow |
| `fields` | The details worth collecting: each one's key, label, type, allowed options and default unit | The lead field definitions |
| `knowledge` | Title and text of each **active** approved answer | `/automation/ai`, "Approved answers" |
| `products` | For products the business has made visible to the AI that match words in the conversation (at most 8): id, code, name, current price, availability (in stock, out of stock, made to order, not tracked) and the quantity available | The catalogue and stock levels |
| `bankAccounts` | Account name, bank, account title, number and branch of accounts marked "show to customers". **Only included when the customer's recent messages ask where to pay.** | Finance accounts |
| `messages` | The most recent messages of the conversation (default 10, at most 50), each as the sender (customer, staff or assistant) and the text. A picture or file is sent only as the words `[image attached]` or `[document attached]`, never as the file | The conversation |
| `customerText` | The customer's own messages from `messages`, used only on our side to check extracted values against what was said | The conversation (not a separate item sent to the provider) |
| `statedText` | Approved answers and earlier staff messages, used only on our side to check drafts for prices and promises | The conversation and the approved answers (not sent separately) |
| `amounts` | The prices and figures a draft may state, used only on our side | Catalogue, approved answers (not sent separately) |
| `known` | What the lead already records, so the assistant does not ask again: name, email, what they want, requirements and the configured detail fields | The lead linked to the conversation |

The instructions that go with the pack (what to do, and the rules: use only the given information, never
invent a price or a stock level, never offer a discount, confirm a payment, promise a refund or a delivery
date) are fixed text in `apps/api/src/modules/ai/prompts/`. Each has a version (for example
`draft-reply.v1`) that is written to the AI log.

## What is never sent

- Passwords, access tokens, API keys or any stored credential.
- Cost prices, supplier details or margins.
- Other customers' conversations, orders, payments or contact details.
- Bank accounts not marked "show to customers", and bank details when the customer did not ask to pay.
- Staff names, emails, phone numbers, roles or permissions.
- Pictures, documents or voice notes (image understanding is not available in Release 1).
- Products the business has switched "visible to AI" off for.

## What is kept

For each request the **AI log** (`/automation/log`, permission `ai:view_logs`) records: when, which
function, which service and model, the prompt version, a hash of the prompt and a hash of the answer
(not the text), the tokens used, how long it took, the confidence, the result (done, failed, timed out,
not sent because AI was off, not sent because a limit was reached) and whether a person approved the
result, who, and when. The text of conversations is not copied into the log.

Each answer is kept as a **suggestion** (`AISuggestion`), with its flags and confidence, until a person
approves, edits or dismisses it. A suggestion changes a lead, adds a note or sends a message only when a
person approves it; the approval is recorded with the approver and marks the AI as the source.

## What the provider does with it

The data goes to the service the workspace connected under Integrations, under that service's own terms.
Release 1 supports Anthropic. Check the provider's data retention and training terms for the account whose
key is used before turning AI on for real customer conversations.

## Switching it off

- Whole workspace: set the mode to **Off** at `/automation/ai`.
- One conversation: untick "AI assistant for this conversation" in the conversation header.
- One kind of data: switch a product's "visible to AI" off, or an approved answer to inactive.
- Cut the connection: disconnect the AI service under Integrations; every request then stops with "no AI
  service is connected".

## Limits

`dailyRequestLimit` (default 500 requests a day) and `monthlyTokenBudget` (default 2,000,000 tokens a
month) stop all requests when reached; the AI settings screen shows the usage.
