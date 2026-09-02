// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const router = vi.hoisted(() => ({
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import type { CourseListItem } from "../src/db/list-courses.js";
import { SCHEDULE_STORAGE_KEY, serializeSchedule } from "./schedule-storage.js";
import type { ScheduleSection } from "./schedule.js";
import { ScheduleWorkspace } from "./schedule-workspace.js";

const course: CourseListItem = {
  id: "CMSC216",
  title: "Introduction to Computer Systems",
  credits: { min: 4, max: 4 },
  gradingMethods: ["Regular"],
  genEdCodes: ["Natural Sciences Lab"],
  description: "Computer systems fundamentals.",
  requirements: [{ label: "Prerequisite", text: "CMSC132." }],
  sections: [
    {
      id: "CMSC216-0101",
      number: "0101",
      deliveryMode: "face-to-face",
      notes: ["Restricted to majors."],
      instructors: ["Ada Lovelace"],
      meetings: [
        {
          days: ["M", "W"],
          startMinutes: 600,
          endMinutes: 675,
          displayTime: "10:00am - 11:15am",
          building: "IRB",
          room: "0324",
          type: "Lecture",
        },
      ],
      seats: { total: 30, open: 2, waitlist: null, holdFile: 5 },
    },
    {
      id: "CMSC216-0201",
      number: "0201",
      deliveryMode: "face-to-face",
      notes: [],
      instructors: ["Grace Hopper"],
      meetings: [
        {
          days: ["T", "Th"],
          startMinutes: 660,
          endMinutes: 735,
          displayTime: "11:00am - 12:15pm",
          building: null,
          room: null,
          type: "Lecture",
        },
      ],
      seats: { total: 30, open: 4, waitlist: 0, holdFile: null },
    },
  ],
};

const savedFirstSection: ScheduleSection = {
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
  ],
};

function renderWorkspace() {
  return render(
    <ScheduleWorkspace
      courses={[course]}
      query="CMSC216"
      status="1 course found."
    />,
  );
}

beforeEach(() => {
  router.replace.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("ScheduleWorkspace", () => {
  test("updates catalog navigation after every input change", async () => {
    renderWorkspace();
    await screen.findByText("No sections added yet.");
    const input = screen.getByRole("searchbox", { name: "Course" });

    fireEvent.change(input, { target: { value: "C" } });
    fireEvent.change(input, { target: { value: "CM" } });
    fireEvent.change(input, { target: { value: "CMS" } });

    expect(router.replace.mock.calls).toEqual([
      ["/?query=C", { scroll: false }],
      ["/?query=CM", { scroll: false }],
      ["/?query=CMS", { scroll: false }],
    ]);
  });

  test("encodes special characters in a live search query", async () => {
    renderWorkspace();
    await screen.findByText("No sections added yet.");

    fireEvent.change(screen.getByRole("searchbox", { name: "Course" }), {
      target: { value: "CMSC 216&" },
    });

    expect(router.replace).toHaveBeenCalledWith(
      "/?query=CMSC+216%26",
      { scroll: false },
    );
  });

  test("clears catalog results when the search input becomes empty", async () => {
    renderWorkspace();
    await screen.findByText("No sections added yet.");
    const input = screen.getByRole("searchbox", { name: "Course" });

    fireEvent.change(input, { target: { value: "CMSC" } });
    fireEvent.change(input, { target: { value: "" } });

    expect(router.replace).toHaveBeenLastCalledWith("/", { scroll: false });
  });

  test("renders an empty schedule after browser state initializes", async () => {
    renderWorkspace();

    expect(await screen.findByText("No sections added yet.")).toBeTruthy();
  });

  test("adds multiple sections of the same course without duplicates", async () => {
    renderWorkspace();

    const addButtons = await screen.findAllByRole("button", {
      name: "Add to schedule",
    });
    fireEvent.click(addButtons[0]!);
    fireEvent.click(addButtons[1]!);

    const selected = await screen.findAllByRole("listitem", {
      name: /CMSC216 section/,
    });
    expect(selected).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Added" })).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Added" })[0]?.hasAttribute(
        "disabled",
      ),
    ).toBe(true);
  });

  test("removes one selected section without affecting the other", async () => {
    renderWorkspace();
    const addButtons = await screen.findAllByRole("button", {
      name: "Add to schedule",
    });
    fireEvent.click(addButtons[0]!);
    fireEvent.click(addButtons[1]!);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Remove CMSC216 section 0101",
      }),
    );

    expect(
      screen.queryByRole("listitem", { name: "CMSC216 section 0101" }),
    ).toBeNull();
    expect(
      screen.getByRole("listitem", { name: "CMSC216 section 0201" }),
    ).toBeTruthy();
  });

  test("clears the schedule without recreating an empty saved payload", async () => {
    renderWorkspace();
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Add to schedule" }))[0]!,
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(SCHEDULE_STORAGE_KEY)).not.toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear schedule" }));

    expect(await screen.findByText("No sections added yet.")).toBeTruthy();
    await waitFor(() =>
      expect(window.localStorage.getItem(SCHEDULE_STORAGE_KEY)).toBeNull(),
    );
  });

  test("restores saved sections without first overwriting them with empty state", async () => {
    window.localStorage.setItem(
      SCHEDULE_STORAGE_KEY,
      serializeSchedule([savedFirstSection]),
    );
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    renderWorkspace();

    expect(
      await screen.findByRole("listitem", { name: "CMSC216 section 0101" }),
    ).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(SCHEDULE_STORAGE_KEY)).toBe(
      serializeSchedule([savedFirstSection]),
    );
  });

  test("keeps search usable when reading storage fails", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    renderWorkspace();

    expect(await screen.findByText("No sections added yet.")).toBeTruthy();
    expect(screen.getByText("Computer systems fundamentals.")).toBeTruthy();
    expect(screen.getByText(/Prerequisite:/)).toBeTruthy();
  });

  test("keeps in-memory additions when writing storage fails", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage full");
    });
    renderWorkspace();

    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Add to schedule" }))[0]!,
    );

    expect(
      await screen.findByRole("listitem", { name: "CMSC216 section 0101" }),
    ).toBeTruthy();
  });

  test("keeps in-memory clearing when removing storage fails", async () => {
    renderWorkspace();
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Add to schedule" }))[0]!,
    );
    await screen.findByRole("listitem", { name: "CMSC216 section 0101" });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear schedule" }));

    expect(await screen.findByText("No sections added yet.")).toBeTruthy();
  });

  test("keeps existing course and section details visible", async () => {
    renderWorkspace();
    await screen.findByText("No sections added yet.");

    expect(screen.getByText("Computer systems fundamentals.")).toBeTruthy();
    expect(screen.getByText(/CMSC132\./)).toBeTruthy();
    expect(screen.getByText(/Ada Lovelace/)).toBeTruthy();
    expect(screen.getByText(/MW 10:00am - 11:15am/)).toBeTruthy();
    expect(screen.getAllByText("Open")[0]?.parentElement?.textContent).toContain(
      "2",
    );
    expect(screen.getByText("Restricted to majors.")).toBeTruthy();
  });
});
