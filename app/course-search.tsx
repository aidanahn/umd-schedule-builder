export function CourseSearch() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-950 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <header className="mb-8">
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
