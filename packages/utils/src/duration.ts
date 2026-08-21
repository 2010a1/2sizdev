/** Domain/storage/API duration is always seconds. UI is responsible for converting minutes. */
export function durationFromMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || Number.isNaN(minutes) || minutes <= 0) {
    throw new RangeError("Duration minutes must be finite and > 0.");
  }
  const seconds = Math.round(minutes * 60);
  if (!Number.isFinite(seconds) || Number.isNaN(seconds) || seconds <= 0) {
    throw new RangeError("Duration seconds must be finite and > 0.");
  }
  return seconds;
}

export function durationToMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || Number.isNaN(seconds) || seconds <= 0) {
    throw new RangeError("Duration seconds must be finite and > 0.");
  }
  return seconds / 60;
}

export function validateDurationSeconds(duration: number | undefined): number | undefined {
  if (duration === undefined) return undefined;
  if (!Number.isFinite(duration) || Number.isNaN(duration) || duration <= 0) {
    throw new RangeError("Duration must be finite and > 0 seconds.");
  }
  return Math.floor(duration);
}
