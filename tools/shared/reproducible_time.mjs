export function generationTimestamp(environment = process.env, now = Date.now()) {
  const rawEpoch = environment.SOURCE_DATE_EPOCH;
  if (rawEpoch === undefined || rawEpoch === "") {
    return formatTimestamp(now);
  }
  if (!/^\d+$/.test(rawEpoch)) {
    throw new Error("SOURCE_DATE_EPOCH must be a non-negative integer number of seconds");
  }
  const seconds = Number(rawEpoch);
  if (!Number.isSafeInteger(seconds) || seconds > Math.floor(8.64e15 / 1_000)) {
    throw new Error("SOURCE_DATE_EPOCH is outside JavaScript's supported date range");
  }
  return formatTimestamp(seconds * 1_000);
}

function formatTimestamp(milliseconds) {
  return new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/, "Z");
}
