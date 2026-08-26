import type { DepartmentSnapshot } from "./build-department-snapshot.js";
import type { Section } from "./parse-course-page.js";

export type SeatCountChangeType =
  | "SEATS_OPENED"
  | "SECTION_FILLED"
  | "OPEN_SEATS_CHANGED"
  | "TOTAL_SEATS_CHANGED"
  | "WAITLIST_CHANGED"
  | "HOLD_FILE_CHANGED";

export type SeatCountChangeEvent = {
  type: SeatCountChangeType;
  courseId: string;
  sectionId: string;
  sectionNumber: string;
  previous: number | null;
  current: number | null;
  delta: number | null;
};

export type SectionPresenceEvent = {
  type: "SECTION_ADDED" | "SECTION_REMOVED";
  courseId: string;
  sectionId: string;
  sectionNumber: string;
  previous: Section["seats"] | null;
  current: Section["seats"] | null;
  delta: null;
};

export type SnapshotComparisonEvent =
  | SeatCountChangeEvent
  | SectionPresenceEvent;

export type DepartmentSnapshotComparison = {
  schemaVersion: 1;
  semester: string;
  department: string;
  beforeCollectedAt: string;
  afterCollectedAt: string;
  summary: {
    events: number;
    sectionsChanged: number;
  };
  events: SnapshotComparisonEvent[];
};

type IndexedSection = {
  courseId: string;
  section: Section;
};

function indexSections(snapshot: DepartmentSnapshot): Map<string, IndexedSection> {
  const sections = new Map<string, IndexedSection>();

  for (const course of snapshot.courses) {
    for (const section of course.sections) {
      if (sections.has(section.id)) {
        throw new Error(`duplicate section ID: ${section.id}`);
      }
      sections.set(section.id, { courseId: course.id, section });
    }
  }

  return sections;
}

function countDelta(
  previous: number | null,
  current: number | null,
): number | null {
  return previous === null || current === null ? null : current - previous;
}

function countChange(
  type: SeatCountChangeType,
  indexedSection: IndexedSection,
  previous: number | null,
  current: number | null,
): SeatCountChangeEvent {
  return {
    type,
    courseId: indexedSection.courseId,
    sectionId: indexedSection.section.id,
    sectionNumber: indexedSection.section.number,
    previous,
    current,
    delta: countDelta(previous, current),
  };
}

function openSeatChangeType(previous: number, current: number) {
  if (previous === 0 && current > 0) {
    return "SEATS_OPENED" as const;
  }
  if (previous > 0 && current === 0) {
    return "SECTION_FILLED" as const;
  }
  return "OPEN_SEATS_CHANGED" as const;
}

function compareSectionCounts(
  before: IndexedSection,
  after: IndexedSection,
): SeatCountChangeEvent[] {
  const events: SeatCountChangeEvent[] = [];
  const previous = before.section.seats;
  const current = after.section.seats;

  if (previous.open !== current.open) {
    events.push(
      countChange(
        openSeatChangeType(previous.open, current.open),
        after,
        previous.open,
        current.open,
      ),
    );
  }
  if (previous.total !== current.total) {
    events.push(
      countChange(
        "TOTAL_SEATS_CHANGED",
        after,
        previous.total,
        current.total,
      ),
    );
  }
  if (previous.waitlist !== current.waitlist) {
    events.push(
      countChange(
        "WAITLIST_CHANGED",
        after,
        previous.waitlist,
        current.waitlist,
      ),
    );
  }
  if (previous.holdFile !== current.holdFile) {
    events.push(
      countChange(
        "HOLD_FILE_CHANGED",
        after,
        previous.holdFile,
        current.holdFile,
      ),
    );
  }

  return events;
}

function validateSnapshots(
  before: DepartmentSnapshot,
  after: DepartmentSnapshot,
): void {
  if (before.status !== "complete" || after.status !== "complete") {
    throw new Error("both snapshots must be complete");
  }
  if (before.semester !== after.semester) {
    throw new Error("snapshot semesters must match");
  }
  if (before.department !== after.department) {
    throw new Error("snapshot departments must match");
  }
}

export function compareDepartmentSnapshots(
  before: DepartmentSnapshot,
  after: DepartmentSnapshot,
): DepartmentSnapshotComparison {
  validateSnapshots(before, after);

  const beforeSections = indexSections(before);
  const afterSections = indexSections(after);
  const sectionIds = [...new Set([...beforeSections.keys(), ...afterSections.keys()])]
    .sort();
  const events: SnapshotComparisonEvent[] = [];
  const changedSections = new Set<string>();

  for (const sectionId of sectionIds) {
    const previous = beforeSections.get(sectionId);
    const current = afterSections.get(sectionId);

    if (!previous && current) {
      events.push({
        type: "SECTION_ADDED",
        courseId: current.courseId,
        sectionId,
        sectionNumber: current.section.number,
        previous: null,
        current: current.section.seats,
        delta: null,
      });
      changedSections.add(sectionId);
      continue;
    }

    if (previous && !current) {
      events.push({
        type: "SECTION_REMOVED",
        courseId: previous.courseId,
        sectionId,
        sectionNumber: previous.section.number,
        previous: previous.section.seats,
        current: null,
        delta: null,
      });
      changedSections.add(sectionId);
      continue;
    }

    if (!previous || !current) {
      continue;
    }

    const sectionEvents = compareSectionCounts(previous, current);
    if (sectionEvents.length > 0) {
      events.push(...sectionEvents);
      changedSections.add(sectionId);
    }
  }

  return {
    schemaVersion: 1,
    semester: before.semester,
    department: before.department,
    beforeCollectedAt: before.collectedAt,
    afterCollectedAt: after.collectedAt,
    summary: {
      events: events.length,
      sectionsChanged: changedSections.size,
    },
    events,
  };
}
