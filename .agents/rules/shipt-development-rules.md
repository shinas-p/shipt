---
trigger: always_on
---

# Shipt Mart / Quick Mart — Agent Development Rules

## 1. Project Context

You are working on the existing Shipt Mart / Quick Mart campus e-commerce application.

- Repository: `shinas-p/shipt`
- Frontend: use the frameworks, routing, components, and styling already present in the repository.
- Backend: Supabase database, authentication, storage, and existing server-side functionality.
- Deployment platform: Vercel.
- User experience: mobile-first campus shopping, product discovery, customer accounts, checkout, order management, and administration.

Before making changes, inspect the repository and understand its actual architecture. Never assume a file, function, table, route, environment variable, or permission exists without checking.

## 2. Understand Before Editing

Before implementing a feature:

1. Inspect relevant existing files and reusable components.
2. Check Git status and identify pre-existing modifications.
3. Trace the existing data flow, authentication, authorization, and API/database calls.
4. Identify the smallest set of files needed.
5. Explain any significant architectural decisions briefly.
6. Reuse existing patterns instead of rebuilding working functionality.

Do not repeatedly ask questions that can be answered by inspecting the repository.

## 3. Protect Existing Work

- Never discard, overwrite, reset, or revert unrelated user changes.
- Never run destructive Git commands such as `git reset --hard`, `git clean -fd`, or broad checkout/revert commands.
- Do not stage unrelated files.
- Keep unrelated feature work isolated whenever practical.
- Never commit, push, deploy, or modify production settings without explicit user approval.
- Treat approval for one action as authorization for that action only. Staging, committing, pushing, deploying, and running production migrations are separate approval steps.
- If the working tree contains unexpected changes, stop and report them before taking risky action.

## 4. Code Quality

- Follow the project's existing TypeScript, React, routing, styling, naming, and folder conventions.
- Prefer simple, maintainable solutions over unnecessary abstractions.
- Reuse existing UI components, hooks, utilities, and design tokens.
- Avoid duplicate components and duplicated business logic.
- Keep components focused and readable.
- Use correct types; avoid `any` unless justified.
- Handle loading, empty, success, validation, and error states.
- Prevent duplicate submissions and unintended repeated actions.
- Remove unused imports and code introduced by your changes.
- Do not add dependencies unless they provide clear value and compatibility has been checked.
- Preserve existing functionality and responsive behavior.

## 5. Supabase and Security

Before changing Supabase functionality, inspect existing migrations, schema, RLS policies, database functions, grants, triggers, and role-checking utilities.

- Use Row Level Security for tables containing customer or administrative data.
- Enforce authorization at the database or trusted server layer, not just by hiding frontend controls.
- Reuse existing authentication and role-management logic.
- Never expose service-role keys, secrets, private tokens, or credentials in frontend code.
- Never trust user-supplied IDs, prices, roles, ownership fields, or approval statuses without validation.
- Validate input on trusted server-side boundaries.
- Preserve existing order, inventory, payment, and checkout behavior unless the user explicitly requests a change.
- Do not modify unrelated database functions or permissions.
- Create clear, reviewed migrations for schema changes.
- Do not apply migrations to production without explicit approval.
- Do not claim that a migration or security check succeeded without actual evidence.

## 6. E-commerce Correctness

Treat product pricing, stock, checkout, payments, orders, refunds, and admin permissions as sensitive business logic.

- Follow existing inventory and order-creation flows.
- Avoid duplicate orders and double inventory deductions.
- Do not mark payments as successful without trusted confirmation.
- Validate quantities and prices on trusted boundaries.
- Keep admin-only functionality inaccessible to unauthorized users.
- Do not automatically publish customer-submitted product suggestions.
- Preserve existing product images and their URLs unless image changes are requested.
- Do not introduce mock data into production flows.

## 7. UI and Brand Consistency

- Maintain the existing Shipt Mart / Quick Mart brand and visual system.
- Use existing colors, spacing, typography, icons, buttons, cards, and modal patterns.
- Build mobile-first layouts that also work on desktop.
- Ensure accessible labels, keyboard navigation, visible focus states, and sufficient contrast.
- Provide clear feedback for user actions.
- Avoid unnecessary redesigns when the task requests a focused feature.
- Do not generate images or consume image-generation credits when the user intends to upload their own images.
- Use realistic loading, empty, and error states rather than fake success messages.

## 8. Testing and Verification

After implementing changes:

1. Run relevant focused tests.
2. Run TypeScript checks.
3. Run the full test suite when practical.
4. Run the production build when practical.
5. Inspect the final diff for unrelated changes, security issues, and accidental deletions.
6. Report test results accurately.
7. Distinguish pre-existing failures from failures introduced by the change.

Never claim tests, builds, deployments, or database operations passed unless they actually ran and passed.

If a command fails, investigate the cause and report it rather than hiding the failure.

## 9. Efficient Agent Workflow

For each task:

1. Understand the requested outcome.
2. Inspect the relevant code and Git state.
3. Make the smallest complete implementation.
4. Test the change.
5. Review the diff and protect unrelated work.
6. Summarize the result and any remaining setup.

Work in coherent batches. Avoid repeatedly scanning the entire repository when a focused inspection is sufficient. Avoid unnecessary explanations while working, but report important risks before proceeding.

## 10. Final Report Format

At the end of implementation, report:

- What was implemented.
- Files created and modified.
- Database migrations or configuration required.
- Security and permission considerations.
- Tests, type checks, and build results.
- Any known limitations or manual steps.
- Git status and whether unrelated changes remain.

Do not say a feature is production-ready merely because the code compiles.

## 11. Approval Boundaries

Default to local implementation and verification only.

Never independently:
- Commit or push code.
- Deploy to production.
- Apply production database migrations.
- Change production environment variables or access policies.
- Delete production data.
- Disable security protections.

Ask for explicit approval before each such action. If the user authorizes a particular action, do only that action and report its result.