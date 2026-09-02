import { describe, expect, test, vi } from "vitest";

import type { ScheduleSection } from "./schedule.js";
import {
  clearStoredSchedule,
  loadSchedule,
  parseStoredSchedule,
  saveSchedule,
  SCHEDULE_STORAGE_KEY,
  serializeSchedule,
  type ScheduleStorage,
} from "./schedule-storage.js";

const section: ScheduleSection = {
  semester: "202608",
  courseId: "CMSC216",
  courseTitle: "Introduction to Computer Systems",
  sectionId: "CMSC216-0101",
  sectionNumber: "0101",
  instructors: ["Ada Lovelace"],
  meetings: [
    {
      days: ["M", "W"],
      displayTime: "10:00am - 11:15am",
      building: "IRB",
      room: "0324",
      type: "Lecture",
    },
    {
      days: [],
      displayTime: null,
      building: null,
      room: null,
      type: null,
    },
  ],
};

const validPayload = {
  version: 1,
  sections: [section],
};

function storageWith(
  overrides: Partial<ScheduleStorage> = {},
): ScheduleStorage {
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    ...overrides,
  };
}

describe("stored schedule parsing", () => {
  test("restores a valid versioned schedule", () => {
    expect(parseStoredSchedule(JSON.stringify(validPayload))).toEqual([
      section,
    ]);
  });

  test("serializes a versioned schedule payload", () => {
    expect(JSON.parse(serializeSchedule([section]))).toEqual(validPayload);
  });

  test.each([
    ["missing value", null],
    ["malformed JSON", "{"],
    ["null root", "null"],
    ["array root", "[]"],
    ["primitive root", '"schedule"'],
    ["missing version", JSON.stringify({ sections: [] })],
    ["wrong version type", JSON.stringify({ version: "1", sections: [] })],
    ["unsupported version", JSON.stringify({ version: 2, sections: [] })],
    ["missing sections", JSON.stringify({ version: 1 })],
    ["wrong sections type", JSON.stringify({ version: 1, sections: {} })],
  ])("returns an empty schedule for %s", (_name, payload) => {
    expect(parseStoredSchedule(payload)).toEqual([]);
  });

  test.each([
    ["semester", { ...section, semester: undefined }],
    ["course ID", { ...section, courseId: undefined }],
    ["course title", { ...section, courseTitle: 216 }],
    ["section ID", { ...section, sectionId: null }],
    ["section number", { ...section, sectionNumber: undefined }],
    ["instructors array", { ...section, instructors: "Ada Lovelace" }],
    ["instructor member", { ...section, instructors: [3] }],
    ["meetings array", { ...section, meetings: null }],
    ["meeting object", { ...section, meetings: ["MW"] }],
    [
      "meeting days array",
      { ...section, meetings: [{ ...section.meetings[0], days: "MW" }] },
    ],
    [
      "meeting day member",
      { ...section, meetings: [{ ...section.meetings[0], days: [1] }] },
    ],
    [
      "display time",
      { ...section, meetings: [{ ...section.meetings[0], displayTime: 600 }] },
    ],
    [
      "building",
      { ...section, meetings: [{ ...section.meetings[0], building: false }] },
    ],
    [
      "room",
      { ...section, meetings: [{ ...section.meetings[0], room: 324 }] },
    ],
    [
      "meeting type",
      { ...section, meetings: [{ ...section.meetings[0], type: [] }] },
    ],
  ])("rejects a section with an invalid %s", (_name, invalidSection) => {
    expect(
      parseStoredSchedule(
        JSON.stringify({ version: 1, sections: [invalidSection] }),
      ),
    ).toEqual([]);
  });
});

describe("schedule storage boundary", () => {
  test("loads and validates the saved payload", () => {
    const getItem = vi.fn(() => JSON.stringify(validPayload));

    expect(loadSchedule(storageWith({ getItem }))).toEqual([section]);
    expect(getItem).toHaveBeenCalledWith(SCHEDULE_STORAGE_KEY);
  });

  test("returns an empty schedule when reading storage fails", () => {
    const storage = storageWith({
      getItem: () => {
        throw new Error("storage unavailable");
      },
    });

    expect(loadSchedule(storage)).toEqual([]);
  });

  test("saves a valid versioned payload", () => {
    const setItem = vi.fn();

    saveSchedule(storageWith({ setItem }), [section]);

    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith(
      SCHEDULE_STORAGE_KEY,
      serializeSchedule([section]),
    );
  });

  test("does not throw when writing storage fails", () => {
    const storage = storageWith({
      setItem: () => {
        throw new Error("storage full");
      },
    });

    expect(() => saveSchedule(storage, [section])).not.toThrow();
  });

  test("removes the saved payload", () => {
    const removeItem = vi.fn();

    clearStoredSchedule(storageWith({ removeItem }));

    expect(removeItem).toHaveBeenCalledWith(SCHEDULE_STORAGE_KEY);
  });

  test("does not throw when removing storage fails", () => {
    const storage = storageWith({
      removeItem: () => {
        throw new Error("storage unavailable");
      },
    });

    expect(() => clearStoredSchedule(storage)).not.toThrow();
  });
});
