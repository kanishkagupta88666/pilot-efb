const configuredDataSource = import.meta.env.VITE_DATA_SOURCE;

if (
  configuredDataSource !== undefined &&
  configuredDataSource !== "mock" &&
  configuredDataSource !== "api"
) {
  throw new Error(
    `Invalid VITE_DATA_SOURCE "${configuredDataSource}". Use "mock" or "api".`,
  );
}

export const DATA_SOURCE = configuredDataSource ?? "mock";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? ""
).replace(/\/+$/, "");
