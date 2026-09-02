# Basic Schedule Builder Design

## Goal

Add a small, browser-local schedule builder to the existing database-backed course search. A user can add specific sections from search results, retain multiple alternatives for the same course, review the selected sections in a simple list, remove individual sections, and clear the schedule.

The first version favors a usable end-to-end workflow over calendar visualization or schedule validation.

## Scope

This change includes:

- An `Add to schedule` action on every section in the existing search results.
- A selected-sections list containing the course, section, instructor, and meeting details needed to identify each choice.
- Removal of one selected section and clearing all selected sections.
- Browser persistence using versioned `localStorage` data.
- Validation of saved browser data before it enters application state.
- Prevention of duplicate entries for the exact same course section.
- Support for multiple sections of the same course.

This change does not include:

- Conflict detection or conflict warnings.
- A weekly calendar grid.
- User accounts or PostgreSQL schedule persistence.
- Named or shareable schedules.
- Automatic selection, replacement, or ranking of sections.
- Changes to catalog ingestion, course search queries, or the database schema.

## Architecture

Course search remains server-backed. `CourseSearchPage` continues to read the query, call the existing database search function, and handle unavailable/empty results on the server.

The returned normalized course data is passed into a client-side schedule workspace. The workspace owns the selected-section state and renders both the existing search-result presentation and the schedule panel. Keeping these interactive elements under one client boundary allows every section action to update the same in-memory schedule without introducing an API, global state library, or database write.

The database query and its `CourseListItem` output remain unchanged. The client workspace derives a smaller saved schedule entry when a section is added; it does not store the entire search response.

## Saved Schedule Model

Each saved entry contains the immutable display data required by the schedule list:

- Semester code.
- Course ID and title.
- Section ID and section number.
- Instructor names.
- Normalized meeting details: days, display time, building, room, and meeting type.

The stable identity is the combination of semester, course ID, and section ID. Adding an entry whose identity is already selected is a no-op. Sections with different IDs remain independent even when they belong to the same course or overlap in time.

The browser payload is a versioned object rather than a bare array. The initial shape is conceptually:

```ts
interface StoredScheduleV1 {
  version: 1;
  sections: ScheduleSection[];
}
```

It is stored under an application-specific key such as `umd-schedule-builder:schedule`. Versioning provides an explicit migration or reset point when the saved model changes later.

## Browser Persistence and Recovery

The schedule initializes on the client after mount to avoid server-rendering mismatches. The local storage boundary handles browser API failures and validates unknown parsed JSON before accepting it. Validation checks the payload version and all required nested field types rather than asserting that parsed JSON is trustworthy.

Missing, malformed, or unsupported saved data produces an empty schedule. It does not prevent course search from rendering. Successful schedule changes update browser storage after the client has initialized.

No data is written to PostgreSQL. Clearing the schedule removes the saved browser payload and resets in-memory state.

## Interface Behavior

The existing search form, course metadata, requirements, section details, and seat information remain visible.

Each section card gains an action with two states:

- `Add to schedule` when the exact section is not selected.
- A disabled or otherwise non-duplicating selected state after it has been added.

The schedule panel is a simple list rather than a calendar. Each item displays the course and section identity, instructors, and meeting rows, with a remove action. The panel includes a clear action when at least one section is selected and an empty message otherwise.

There are intentionally no warnings for overlapping meeting times. Adding a second section of the same course neither replaces nor removes the first.

## Testing

Focused offline tests cover:

- Adding a section.
- Treating an exact duplicate addition as a no-op.
- Retaining multiple sections of the same course.
- Removing one section without affecting the others.
- Clearing the complete schedule.
- Serializing and restoring a valid schedule.
- Falling back to an empty schedule for malformed, incomplete, or unsupported saved payloads.
- Rendering the existing course results through the new client workspace without losing current metadata and section details.

The full existing test suite, TypeScript checks, and production Next.js build run afterward to protect the scraper, PostgreSQL ingestion, automatic ingestion, and database-backed search behavior.

## Completion Criteria

The feature is complete when a user can search the existing CMSC Fall 2026 catalog, add one or more specific sections, see all selected alternatives in a simple schedule list, remove or clear them, and recover the same selection after refreshing the browser. Exact duplicates are not created, invalid saved state fails safely, and all existing verification remains green.
