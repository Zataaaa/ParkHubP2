export function validateReservationPeriod(startTime: unknown, endTime: unknown) {
  if (typeof startTime !== 'string' || typeof endTime !== 'string') {
    return null;
  }

  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return null;
  }

  return { start, end };
}

export function hasTimeConflict(
  newStart: Date,
  newEnd: Date,
  existingStart: Date,
  existingEnd: Date
) {
  return newStart < existingEnd && newEnd > existingStart;
}

export function canReserveSpot(active: boolean, hasConflict: boolean) {
  return active && !hasConflict;
}

export function validateExtensionEndTime(
  currentEnd: Date,
  newEndTime: unknown,
  now: Date
): Date | null {
  // TODO PRACTICE 2:
  // Determine whether the requested end time is a valid extension of the
  // current reservation. Return the parsed date only when it is valid.
  return null;
}

export function isReservationExtendable(status: string, endTime: Date, now: Date): boolean {
  // TODO PRACTICE 2: a reservation can be extended only while it is ACTIVE and has not ended.
  return false;
}
