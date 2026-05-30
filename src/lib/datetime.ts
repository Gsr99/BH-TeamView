// Converts a datetime-local input value ("YYYY-MM-DDTHH:mm", local time) to UTC ISO string.
// JavaScript parses datetime strings without timezone as local time, so new Date() is correct here.
export function localInputToISO(value: string): string {
  if (!value) return value;
  return new Date(value).toISOString();
}

// Returns UTC ISO boundaries for a full local calendar day.
// e.g. "2026-05-29" in UTC+1 → start="2026-05-28T23:00:00.000Z", end="2026-05-29T22:59:59.000Z"
export function localDayToUTCRange(localDate: string): { start: string; end: string } {
  return {
    start: new Date(`${localDate}T00:00:00`).toISOString(),
    end: new Date(`${localDate}T23:59:59`).toISOString(),
  };
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localDateTimeInputValue(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${localDateKey(date)}T${hours}:${minutes}`;
}

export function localDateKeyFromValue(value: string | null | undefined) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  return localDateKey(date);
}

export function localDateTimeInputValueFromValue(value: string | null | undefined) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 16);
  }

  return localDateTimeInputValue(date);
}
