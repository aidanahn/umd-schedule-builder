# Next.js Web Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a buildable single-package Next.js application with Tailwind CSS and a deliberately simple, nonfunctional UMD course-search shell.

**Architecture:** Keep the existing scraper, database, and CLI modules under `src` while adding the Next.js App Router under `app` in the same npm package. The initial page is server-rendered, contains no database or network calls, and exposes a focused `CourseSearch` component that can be tested without a browser.

**Tech Stack:** Node.js 20.9+, TypeScript 5.9, Next.js 16.3.3, React 19.2.8, Tailwind CSS 4.3.3, PostCSS 8, Vitest, Cheerio

**Spec:** `docs/superpowers/specs/2026-08-30-nextjs-web-foundation-design.md`

## Global Constraints

- Keep the project as one npm package; do not introduce workspaces or an `apps/web` directory.
- Preserve the behavior and names of `scrape`, `ingest:db`, `db:*`, `test`, `test:db`, and `test:live`.
- Do not add database queries, API routes, authentication, notifications, analytics, deployment configuration, or a component library.
- Keep the page server-rendered; do not add `"use client"` or browser state.
- The search input may accept text, but the search action must remain disabled and must not submit a form.
- Keep styling restrained and responsive; visual branding is outside this change.
- Treat dependency/configuration scaffolding as configuration work; use red-green TDD for the rendered component and route behavior.

---

### Task 1: Build the Next.js Course Search Foundation

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Modify: `tsconfig.json`
- Create: `postcss.config.mjs`
- Create: `next-env.d.ts` (generated and maintained by Next.js)
- Create: `app/course-search.test.tsx`
- Create: `app/course-search.tsx`
- Create: `app/page.test.tsx`
- Create: `app/page.tsx`
- Create: `app/layout.tsx`
- Create: `app/globals.css`

**Interfaces:**

- Produces: `CourseSearch(): React.JSX.Element` from `app/course-search.tsx`.
- Produces: default App Router page from `app/page.tsx`.
- Produces: root layout metadata with title `UMD Schedule Builder` and description `Search UMD courses and build a schedule.`.
- Produces: package commands `npm run dev`, `npm run build`, and `npm run start`.
- Preserves: every existing CLI and database command without changing its entrypoint.

- [ ] **Step 1: Verify the existing project before adding web dependencies**

Run:

```bash
npm run check
npm run test:db
git status --short
```

Expected: the offline and PostgreSQL suites pass and `git status --short` prints nothing because the plan is already committed.

- [ ] **Step 2: Install the approved Next.js, React, and Tailwind toolchain**

Run:

```bash
npm install next@16.3.3 react@19.2.8 react-dom@19.2.8
npm install --save-dev tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 postcss@8.5.6 @types/react@19.2.18 @types/react-dom@19.2.5
```

Expected: `package.json` and `package-lock.json` contain the web dependencies while existing dependency ranges remain unchanged.

- [ ] **Step 3: Add package scripts and the Next.js Node.js floor**

Change `engines.node` from `>=20` to `>=20.9.0`. Add these scripts without renaming or removing existing scripts:

```json
{
  "build": "next build",
  "dev": "next dev",
  "start": "next start"
}
```

Expected: the scraper and database commands remain byte-for-byte equivalent in meaning.

- [ ] **Step 4: Extend TypeScript configuration for Next.js and existing Node modules**

Replace `tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "types": ["node", "vitest/globals"]
  },
  "include": [
    "next-env.d.ts",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.ts",
    "**/*.tsx"
  ],
  "exclude": ["node_modules"]
}
```

This keeps strict parser/database checks while enabling JSX and Next-generated route types.

- [ ] **Step 5: Add Tailwind's PostCSS configuration and build ignores**

Create `postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

Add these lines to `.gitignore`:

```gitignore
.next/
out/
```

Do not hand-edit `next-env.d.ts`; Next.js creates it during the first framework command.

- [ ] **Step 6: Write the failing accessible search-shell test**

Create `app/course-search.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { describe, expect, test } from "vitest";

import { CourseSearch } from "./course-search.js";

describe("CourseSearch", () => {
  test("renders fixed catalog context and a disabled search action", () => {
    const $ = load(renderToStaticMarkup(<CourseSearch />));

    expect($("h1").text()).toBe("UMD Course Search");
    expect($("label[for='semester']").text()).toBe("Semester");
    expect($("select#semester").val()).toBe("202608");
    expect($("select#semester").is("[disabled]")).toBe(true);
    expect($("label[for='department']").text()).toBe("Department");
    expect($("input#department").attr("value")).toBe("CMSC");
    expect($("input#department").is("[readonly]")).toBe(true);
    expect($("label[for='course-query']").text()).toBe("Course");
    expect($("input#course-query[type='search']")).toHaveLength(1);
    expect($("button[type='button']").text()).toBe("Search");
    expect($("button[type='button']").is("[disabled]")).toBe(true);
    expect($("[role='status']").text()).toBe(
      "Catalog search will be connected next.",
    );
  });
});
```

The production change that makes this pass is the presence of a correctly labeled, non-submitting search shell. Removing a label, changing the fixed catalog context, or enabling the unavailable action must fail the test.

- [ ] **Step 7: Run the search-shell test RED**

Run:

```bash
npx vitest run app/course-search.test.tsx
```

Expected: FAIL because `app/course-search.tsx` does not exist.

- [ ] **Step 8: Implement the server-rendered search component**

Create `app/course-search.tsx`:

```tsx
export function CourseSearch() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
          <p className="mb-2 text-sm font-medium text-red-700">
            UMD Schedule Builder
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            UMD Course Search
          </h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            Search the course catalog before adding classes to your schedule.
          </p>
        </header>

        <section
          aria-labelledby="course-search-heading"
          className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <h2 id="course-search-heading" className="text-lg font-medium">
            Search courses
          </h2>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium" htmlFor="semester">
                Semester
              </label>
              <select
                className="mt-2 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                defaultValue="202608"
                disabled
                id="semester"
              >
                <option value="202608">Fall 2026</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium" htmlFor="department">
                Department
              </label>
              <input
                className="mt-2 w-full rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-slate-700"
                id="department"
                readOnly
                value="CMSC"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-sm font-medium" htmlFor="course-query">
                Course
              </label>
              <input
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-red-700 focus:ring-2 focus:ring-red-100"
                id="course-query"
                name="query"
                placeholder="Try CMSC131 or Object-Oriented Programming"
                type="search"
              />
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              className="cursor-not-allowed rounded-md bg-slate-300 px-4 py-2 font-medium text-slate-600"
              disabled
              type="button"
            >
              Search
            </button>
            <p className="text-sm text-slate-500" role="status">
              Catalog search will be connected next.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
```

Do not wrap the controls in a form. The button uses `type="button"` and remains disabled, so pressing Enter or clicking cannot imply a successful catalog request.

- [ ] **Step 9: Run the search-shell test GREEN**

Run:

```bash
npx vitest run app/course-search.test.tsx
```

Expected: one passing component test with no browser or database dependency.

- [ ] **Step 10: Write the failing App Router page test**

Create `app/page.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { describe, expect, test } from "vitest";

import Page from "./page.js";

describe("home page", () => {
  test("renders the course search shell", () => {
    const $ = load(renderToStaticMarkup(<Page />));

    expect($("main")).toHaveLength(1);
    expect($("h1").text()).toBe("UMD Course Search");
    expect($("input#course-query[type='search']")).toHaveLength(1);
  });
});
```

The production change that makes this pass is wiring the tested search component into the App Router home page.

- [ ] **Step 11: Run the page test RED**

Run:

```bash
npx vitest run app/page.test.tsx
```

Expected: FAIL because `app/page.tsx` does not exist.

- [ ] **Step 12: Add the App Router page, layout, metadata, and global Tailwind import**

Create `app/page.tsx`:

```tsx
import { CourseSearch } from "./course-search.js";

export default function Page() {
  return <CourseSearch />;
}
```

Create `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "UMD Schedule Builder",
  description: "Search UMD courses and build a schedule.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Create `app/globals.css`:

```css
@import "tailwindcss";

:root {
  color-scheme: light;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f8fafc;
  color: #020617;
  font-family: Arial, Helvetica, sans-serif;
}

button,
input,
select {
  font: inherit;
}
```

- [ ] **Step 13: Run the page/component tests GREEN**

Run:

```bash
npx vitest run app/course-search.test.tsx app/page.test.tsx
```

Expected: both test files pass.

- [ ] **Step 14: Generate Next.js types and verify the production build**

Run:

```bash
npm run build
npm run typecheck
```

Expected: Next.js creates `next-env.d.ts` and `.next`, compiles the `/` route as static content, and TypeScript passes across both `app` and `src`. Inspect any automatic `tsconfig.json` adjustment; keep it only if Next.js requires it and rerun typecheck.

- [ ] **Step 15: Run the full regression suite**

Run:

```bash
npm run check
npm run test:db
git diff --check
git status --short
```

Expected: all existing scraper/database tests plus the two new web tests pass, PostgreSQL integration remains green, and only the intended web/configuration files are modified.

- [ ] **Step 16: Commit the buildable web foundation**

```bash
git add .gitignore package.json package-lock.json tsconfig.json postcss.config.mjs next-env.d.ts app
git commit -m "Add Next.js course search shell"
```

Expected: one natural implementation commit containing the complete buildable foundation, with no `.next` output or local environment values tracked.

### Task 2: Final Browser Smoke Check and Review

**Files:**

- Verify only; do not create or modify product files unless the smoke check reveals a tested defect.

**Interfaces:**

- Consumes: `npm run dev` and the static `/` route from Task 1.
- Produces: evidence that the page loads at `http://localhost:3000` and that intended controls are visible and disabled.

- [ ] **Step 1: Start the local web server**

Run:

```bash
npm run dev
```

Expected: Next.js reports a ready local URL without database configuration errors. Keep the process running only for the smoke check.

- [ ] **Step 2: Inspect the rendered page**

Open `http://localhost:3000` and verify:

- The page heading is `UMD Course Search`.
- Semester displays `Fall 2026` and cannot be changed.
- Department displays `CMSC` and is read-only.
- The course input accepts text.
- The Search button remains disabled.
- The layout is readable at both desktop and narrow viewport widths.

If the page fails one of these checks, add a focused failing test to the owning test file before changing production code, then rerun Task 1 Steps 13–15.

- [ ] **Step 3: Stop the local server and run final verification**

Run:

```bash
npm run build
npm run check
npm run test:db
git status --short
git diff --check
```

Expected: the build and every suite pass from a clean committed tree. No extra commit is needed when the smoke check requires no changes.
