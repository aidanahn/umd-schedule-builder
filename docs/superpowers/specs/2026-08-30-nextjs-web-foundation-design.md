# Next.js Web Foundation Design

## Goal

Add a minimal Next.js website to the existing Node.js and TypeScript package without disrupting the Testudo scraper or PostgreSQL ingestion commands. The first page will be an intentionally plain course-search shell that can consume catalog queries in the next feature.

## Scope

This change includes:

- Next.js using the App Router.
- React and Tailwind CSS in the existing root package.
- A responsive root layout with basic page metadata.
- An empty course-search interface for Fall 2026 and CMSC.
- Package scripts for local development, production builds, and production startup.
- Verification that existing scraper and database behavior still passes its current test suites.

This change does not include:

- Catalog database queries or API routes.
- A functional search submission.
- User accounts, watched sections, notifications, or schedule building.
- A component library, detailed visual design, analytics, or deployment.

## Project Structure

The project remains a single npm package. Next.js files live at the repository root alongside the existing `src` directory:

```text
app/
  globals.css
  layout.tsx
  page.tsx
src/
  cli/
  db/
  testudo/
```

The existing CLI and database modules remain under `src`. They do not import Next.js, and their commands keep their current behavior. Future server-side web code can import the existing Drizzle connection and schema modules directly without creating a workspace package or copying types.

## Web Application

The App Router root layout provides document metadata and imports the Tailwind-backed global stylesheet. The initial page is server-rendered and does not require a client component.

The page contains:

- A `UMD Course Search` heading.
- A semester control fixed to `Fall 2026`.
- A department control showing `CMSC`.
- A course search input with an accessible label.
- A disabled search button and short message explaining that catalog search will be connected next.

The presentation remains deliberately restrained: readable spacing, responsive form layout, accessible contrast, and native form controls. Product branding and visual polish are deferred.

## Configuration and Scripts

Next.js, React, React DOM, Tailwind CSS, and their required development tooling are added to the existing package. Configuration follows the current supported setup for the installed versions rather than relying on an older generated template.

The package adds:

- `npm run dev` to start the Next.js development server.
- `npm run build` to create a production build.
- `npm run start` to run the production build.

Existing scripts including `scrape`, `ingest:db`, `db:*`, `test`, `test:db`, and `test:live` remain available and retain their current meanings.

TypeScript configuration is extended only as required by Next.js and JSX. Existing Node.js source files remain typechecked.

## Data Flow and Error Handling

The initial page has no database or network data flow. It renders static controls and cannot submit a search, so it cannot imply that unavailable catalog results were successfully queried.

Next.js build and runtime errors use the framework defaults for this foundation. Application-specific loading, empty, and error states will be designed with the catalog query feature.

## Verification

The implementation is complete when:

- The existing offline suite passes.
- The guarded PostgreSQL integration suite passes.
- TypeScript passes for both existing modules and the Next.js application.
- A production Next.js build succeeds.
- The generated page renders an accessible search input and disabled search action.
- Existing `scrape` and `ingest:db` package scripts are unchanged in behavior.

No deployment or live database query is required for this foundation.
