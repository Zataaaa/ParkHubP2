import { isValidObjectId } from 'mongoose';
import { ParkingSpot } from '../parking-spots/parking-spot.model';
import { Reservation } from './reservation.model';
import {
  canReserveSpot,
  hasTimeConflict,
  isReservationExtendable,
  validateExtensionEndTime,
  validateReservationPeriod
} from './reservation.rules';

export class ReservationError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

export async function getReservations() {
  return Reservation.find().populate('parkingSpotId', 'number').sort({ startTime: -1 });
}

export async function createReservation(input: {
  parkingSpotId: unknown;
  startTime: unknown;
  endTime: unknown;
}) {
  if (typeof input.parkingSpotId !== 'string' || !isValidObjectId(input.parkingSpotId)) {
    throw new ReservationError(400, 'Invalid parking spot ID');
  }

  const period = validateReservationPeriod(input.startTime, input.endTime);
  if (!period) {
    throw new ReservationError(400, 'Start time must be before end time');
  }

  const spot = await ParkingSpot.findById(input.parkingSpotId);
  if (!spot) {
    throw new ReservationError(404, 'Parking spot not found');
  }

  if (!spot.active) {
    throw new ReservationError(409, 'Parking spot is not active');
  }

  const overlappingReservations = await Reservation.find({
    parkingSpotId: spot._id,
    status: 'ACTIVE',
    startTime: { $lt: period.end },
    endTime: { $gt: period.start }
  });

  const hasConflict = overlappingReservations.some((reservation) =>
    hasTimeConflict(period.start, period.end, reservation.startTime, reservation.endTime)
  );

  if (!canReserveSpot(spot.active, hasConflict)) {
    throw new ReservationError(409, 'Parking spot is not available for this time range');
  }

  return Reservation.create({
    parkingSpotId: spot._id,
    startTime: period.start,
    endTime: period.end,
    status: 'ACTIVE'
  });
}

export async function cancelReservation(id: string) {
  if (!isValidObjectId(id)) {
    return null;
  }

  return Reservation.findByIdAndUpdate(id, { status: 'CANCELLED' }, { new: true });
}

export async function extendReservation(id: string, endTime: unknown) {
  // 1. Locate the reservation (a malformed id cannot match any document).
  if (!isValidObjectId(id)) {
    throw new ReservationError(404, 'Reservation not found');
  }

  const reservation = await Reservation.findById(id);
  if (!reservation) {
    throw new ReservationError(404, 'Reservation not found');
  }

  // 2. It must be ACTIVE and still in force.
  const now = new Date();
  if (!isReservationExtendable(reservation.status ?? '', reservation.endTime, now)) {
    throw new ReservationError(409, 'Reservation cannot be extended');
  }

  // 3. The new end time must be a valid date strictly after the current one.
  const newEnd = validateExtensionEndTime(reservation.endTime, endTime, now);
  if (!newEnd) {
    throw new ReservationError(400, 'End time must be a valid date later than the current end time');
  }

  // 4. Look for other ACTIVE reservations of the same spot in the new range.
  //    The reservation itself is excluded; CANCELLED ones never block.
  const overlappingReservations = await Reservation.find({
    parkingSpotId: reservation.parkingSpotId,
    status: 'ACTIVE',
    _id: { $ne: reservation._id },
    startTime: { $lt: newEnd },
    endTime: { $gt: reservation.startTime }
  });

  const hasConflict = overlappingReservations.some((other) =>
    hasTimeConflict(reservation.startTime, newEnd, other.startTime, other.endTime)
  );

  if (hasConflict) {
    throw new ReservationError(409, 'Parking spot is not available for this time range');
  }

  // 5. Persist only now that every rule passed.
  reservation.endTime = newEnd;
  await reservation.save();

  return reservation;
}
