# Backend Coding Instructions

## General Rules

- Use modern JavaScript/TypeScript best practices.
- Use `async` / `await` for all asynchronous operations.
- Do not use callback-style async code unless absolutely necessary.
- Keep code clean, readable, and modular.
- Avoid repeating logic. Reuse helper functions, services, and utilities.
- Use meaningful variable, function, and file names.
- Keep functions small and focused on one responsibility.

## API Handler Rules

- Every API handler must use `try/catch`.
- All successful API responses must follow this format:

```js
{
  success: true,
  message: "",
  data
}
All error responses must follow this format:
{
  success: false,
  error: ""
}
Status Codes
Use 200 for successful GET, PATCH, PUT, or DELETE requests.
Use 201 for successful resource creation.
Use 400 for:
Missing required fields
Invalid input
Invalid ID
Missing document/resource
Validation errors
Use 401 for unauthenticated requests.
Use 403 for unauthorized access.
Use 404 only when the route or resource clearly does not exist.
Use 500 for errors caught inside catch.

Example:

try {
  // handler logic
} catch (error) {
  return res.status(500).json({
    success: false,
    error: error.message || "Internal server error"
  });
}
Validation
Validate all required fields before performing database operations.
Validate IDs before using them in queries.
Never assume request body, params, or query values are valid.
Return early when validation fails.
Keep validation messages clear and specific.
Database Rules
Always check whether a document exists before updating or deleting it.
Do not expose internal database errors directly to users.
Use lean queries where appropriate for read-only operations.
Avoid unnecessary database calls.
Use transactions when multiple related writes must succeed together.
Security
Never trust client input.
Never expose passwords, tokens, secrets, or internal error details.
Hash passwords before storing them.
Use environment variables for secrets and configuration.
Apply authentication and authorization checks where needed.
Sanitize user input when required.
Code Structure
Keep routes, controllers, services, models, and utilities separated.
Put business logic in services, not directly inside route files.
Keep API handlers thin and easy to read.
Use constants for repeated messages, roles, statuses, and config values.
Avoid hardcoded values when they should be configurable.
Response Messages
Success messages should be short and clear.
Error messages should explain what went wrong without leaking sensitive details.
Use consistent wording across similar APIs.
Logging
Log server-side errors for debugging.
Do not log sensitive data such as passwords, tokens, or private user data.
Use structured logging where possible.
Example API Handler
export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: "User ID is required"
      });
    }

    const user = await User.findById(id);

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "User not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "User fetched successfully",
      data: user
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error"
    });
  }
};
Final Checklist

Before completing any backend code:

Is async/await used correctly?
Is every API handler wrapped in try/catch?
Are success and error responses consistent?
Are validation errors returning 400?
Are caught errors returning 500?
Are required fields validated?
Are IDs validated before database queries?
Are missing documents handled?
Is sensitive data protected?
Is the code clean, reusable, and easy to maintain?