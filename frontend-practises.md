Next.js Standards
4. Use App Router Correctly

Always:

Use Server Components by default
Use Client Components only when necessary
Minimize "use client"

Use client components only for:

Hooks
Event handlers
Browser APIs
Interactive UI
5. Data Fetching Rules
Prefer Server Fetching First

Use:

Server Components
Route handlers

6. API Layer Standards

Never call APIs directly inside components.

Bad:

useEffect(() => {
  axios.get("/api/users");
}, []);

Good:

services/users/getUsers.ts

Use centralized API clients.

Example:

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
});
UI/UX Standards
7. Dashboard UI Expectations

Dashboard must feel:

Professional
Clean
Fast
Enterprise-grade

Avoid:

Excessive colors
Over-animations
Inconsistent spacing
Random font sizes

Use:

Consistent spacing scale
Proper typography hierarchy
Card-based layouts
Responsive grids
Skeleton loaders
Empty states
Error states
8. Responsive Design is Mandatory

Support:

Mobile
Tablet
Desktop
Ultrawide

Never hardcode widths unnecessarily.

Prefer:

grid-cols-1 md:grid-cols-2 xl:grid-cols-4
9. Accessibility Requirements

Always include:

Proper labels
Semantic HTML
Keyboard accessibility
ARIA where necessary
Focus states

Never use divs where buttons or links should exist.

Component Standards
10. Component Design Rules

Guidelines:

One responsibility per component
Avoid massive files
Extract reusable logic
Keep JSX readable


11. Reusable Components

Build reusable abstractions for:

Tables
Modals
Forms
Filters
Pagination
Cards
Charts

Avoid duplication.

12. Table Standards

Tables should support:

Pagination
Loading state
Empty state
Sorting
Filtering
Row actions
Column configuration

Prefer TanStack Table.


Form Standards
14. Form Architecture

Use:

React Hook Form
Zod validation

Validation must exist both:

Client-side
Server-side

Never trust frontend validation alone.

Authentication & Security
15. Security Standards

Never:

Expose secrets
Hardcode tokens
Store sensitive data insecurely

Always:

Use environment variables
Sanitize inputs
Validate payloads
Handle authorization properly

18. Loading Experience

Every async UI must include:

Loading skeleton
Error state


Never leave blank screens.

Error Handling
19. Error Handling Rules

Always:

Handle API failures
Handle edge cases
Display user-friendly messages
Log useful debug info

Never expose raw backend errors to users.

Styling Standards
20. Tailwind Rules

Prefer utility-first styling.

Avoid:

Massive class strings
Inline styles
Duplicated utilities

Use helper utilities:

cn()

Extract repeated patterns into components.


22. Naming Conventions

Use:

PascalCase → Components
camelCase → variables/functions
UPPER_SNAKE_CASE → constants

Names must be descriptive.

Bad:

const data = [];

Good:

const activeUsersData = [];
23. Clean Code Rules

Avoid:

Nested ternaries
Long functions
Magic strings
Duplicate logic

Prefer:

Early returns
Constants
Utility functions