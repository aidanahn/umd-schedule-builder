# Testudo Course Text Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse course-level metadata from both Testudo text sources without changing the snapshot schema or section parsing.

**Architecture:** Keep course metadata extraction inside `parse-course-page.ts`. Convert both `.approved-course-text` and `.course-text` into the same labeled-or-unlabeled inputs, classify them through one shared path, then deduplicate descriptions and requirements in display order.

**Tech Stack:** Node.js, TypeScript, Cheerio, Vitest

**Spec:** User-approved design in the current task.

## Global Constraints

- Preserve the existing `Course` output schema.
- Do not change section parsing unless a regression proves it necessary.
- Preserve source order while deduplicating metadata.
- Keep truly absent descriptions and requirements as `null` and `[]`.

---

### Task 1: Lock Course Metadata Behavior Into Offline Tests

**Files:**
- Create: `src/testudo/fixtures/course-metadata/cmsc818j.html`
- Create: `src/testudo/fixtures/course-metadata/cmsc298a.html`
- Create: `src/testudo/parse-course-metadata.test.ts`
- Read: `src/testudo/fixtures/cmsc131-202608.html`

**Interfaces:**
- Consumes: `parseCoursePage(ParseCoursePageInput): ParseCoursePageResult`
- Produces: offline expectations for normal, supplemental, empty, labeled, and deduplicated metadata

- [ ] **Step 1: Add hand-checked Testudo-shaped fixtures and literal assertions.**
- [ ] **Step 2: Run `npx vitest run src/testudo/parse-course-metadata.test.ts`.**
- [ ] **Step 3: Confirm failures are caused by ignored `.course-text` metadata.**

### Task 2: Parse Both Course-Level Text Sources

**Files:**
- Modify: `src/testudo/parse-course-page.ts`
- Test: `src/testudo/parse-course-metadata.test.ts`

**Interfaces:**
- Consumes: `.approved-course-text` and `.course-text` elements in document order
- Produces: the existing `{ description: string | null, requirements: LabeledText[] }` shape

- [ ] **Step 1: Split `.course-text` at double line breaks while retaining text order.**
- [ ] **Step 2: Route explicit labels and conservative unlabeled registration language through the shared classifier.**
- [ ] **Step 3: Deduplicate descriptions and labeled metadata while retaining the first occurrence.**
- [ ] **Step 4: Run the focused test and refactor only after it passes.**

### Task 3: Verify Offline and Live Behavior

**Files:**
- Verify: `src/testudo/*.test.ts`
- Generate ignored artifact: `data/snapshots/202608/CMSC/*.json`

**Interfaces:**
- Consumes: `npm run check`, `npm run test:live`, and `npm run scrape -- --semester 202608 --department CMSC`
- Produces: a verified CMSC snapshot and an audit of remaining absent metadata

- [ ] **Step 1: Run `npm run check`.**
- [ ] **Step 2: Run `npm run test:live`.**
- [ ] **Step 3: Run the parameterized CMSC scrape.**
- [ ] **Step 4: Audit CMSC818J, CMSC848P, and every remaining `null` description or empty requirements array against the live HTML.**
