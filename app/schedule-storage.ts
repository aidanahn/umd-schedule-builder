import type { ScheduleMeeting, ScheduleSection } from "./schedule.js";

export const SCHEDULE_STORAGE_KEY = "umd-schedule-builder:schedule";

export interface ScheduleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredScheduleV1 {
  version: 1;
  sections: ScheduleSection[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isScheduleMeeting(value: unknown): value is ScheduleMeeting {
  return (
    isRecord(value) &&
    isStringArray(value.days) &&
    isNullableString(value.displayTime) &&
    isNullableString(value.building) &&
    isNullableString(value.room) &&
    isNullableString(value.type)
  );
}

function isScheduleSection(value: unknown): value is ScheduleSection {
  return (
    isRecord(value) &&
    typeof value.semester === "string" &&
    typeof value.courseId === "string" &&
    typeof value.courseTitle === "string" &&
    typeof value.sectionId === "string" &&
    typeof value.sectionNumber === "string" &&
    isStringArray(value.instructors) &&
    Array.isArray(value.meetings) &&
    value.meetings.every(isScheduleMeeting)
  );
}

function isStoredScheduleV1(value: unknown): value is StoredScheduleV1 {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.sections) &&
    value.sections.every(isScheduleSection)
  );
}

function copySection(section: ScheduleSection): ScheduleSection {
  return {
    ...section,
    instructors: [...section.instructors],
    meetings: section.meetings.map((meeting) => ({
      ...meeting,
      days: [...meeting.days],
    })),
  };
}

export function parseStoredSchedule(value: string | null): ScheduleSection[] {
  if (value === null) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);

    return isStoredScheduleV1(parsed)
      ? parsed.sections.map(copySection)
      : [];
  } catch {
    return [];
  }
}

export function serializeSchedule(
  sections: readonly ScheduleSection[],
): string {
  return JSON.stringify({ version: 1, sections });
}

export function loadSchedule(storage: ScheduleStorage): ScheduleSection[] {
  try {
    return parseStoredSchedule(storage.getItem(SCHEDULE_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function saveSchedule(
  storage: ScheduleStorage,
  sections: readonly ScheduleSection[],
): void {
  try {
    storage.setItem(SCHEDULE_STORAGE_KEY, serializeSchedule(sections));
  } catch {
    // The in-memory schedule remains usable when browser storage is unavailable.
  }
}

export function clearStoredSchedule(storage: ScheduleStorage): void {
  try {
    storage.removeItem(SCHEDULE_STORAGE_KEY);
  } catch {
    // Clearing in memory still succeeds when browser storage is unavailable.
  }
}
