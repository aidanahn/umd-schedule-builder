export interface CatalogSearchUrlInput {
  query: string;
  department?: string | undefined;
}

export function buildCatalogSearchUrl(input: CatalogSearchUrlInput): string {
  const parameters = new URLSearchParams();
  if (input.query) parameters.set("query", input.query);
  if (input.department) parameters.set("department", input.department);
  const queryString = parameters.toString();
  return queryString ? `/?${queryString}` : "/";
}
