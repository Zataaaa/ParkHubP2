import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Types } from 'mongoose';
import app from '../../../app';
import { Reservation } from '../reservation.model';
import { isReservationExtendable, validateExtensionEndTime } from '../reservation.rules';
import * as reservationService from '../reservation.service';

// Fixed clock used by every scenario: "now" = 2026-11-01 09:00Z.
const NOW = new Date('2026-11-01T09:00:00.000Z');
const at = (hhmm: string) => new Date(`2026-11-01T${hhmm}:00.000Z`);
const iso = (hhmm: string) => at(hhmm).toISOString();

// R1: ACTIVE reservation in progress, 08:00-10:00.
function makeReservation(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    parkingSpotId: new Types.ObjectId(),
    startTime: at('08:00'),
    endTime: at('10:00'),
    status: 'ACTIVE',
    save: jest.fn(async () => undefined),
    ...overrides
  };
}

// R2: another ACTIVE reservation of the same spot, 11:00-12:00.
function makeOther(spotId: Types.ObjectId, overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    parkingSpotId: spotId,
    startTime: at('11:00'),
    endTime: at('12:00'),
    status: 'ACTIVE',
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------
describe('validateExtensionEndTime (pure rule)', () => {
  const currentEnd = at('10:00');

  test('TC-01 returns the parsed date when the new end is later than the current end', () => {
    // Arrange
    const requested = iso('10:30');

    // Act
    const result = validateExtensionEndTime(currentEnd, requested, NOW);

    // Assert
    expect(result).toEqual(at('10:30'));
  });

  test('TC-03 accepts an ISO string with an explicit time zone offset', () => {
    const result = validateExtensionEndTime(currentEnd, '2026-11-01T04:30:00-06:00', NOW);

    expect(result).toEqual(at('10:30'));
  });

  test('TC-21 accepts an extension of exactly one minute', () => {
    const result = validateExtensionEndTime(currentEnd, iso('10:01'), NOW);

    expect(result).toEqual(at('10:01'));
  });

  test('TC-08 returns null when the new end time is missing', () => {
    expect(validateExtensionEndTime(currentEnd, undefined, NOW)).toBeNull();
  });

  test('TC-09 returns null when the new end time is not a string', () => {
    expect(validateExtensionEndTime(currentEnd, at('10:30').getTime(), NOW)).toBeNull();
    expect(validateExtensionEndTime(currentEnd, null, NOW)).toBeNull();
    expect(validateExtensionEndTime(currentEnd, { endTime: iso('10:30') }, NOW)).toBeNull();
  });

  test('TC-10 returns null when the text is not a valid date', () => {
    expect(validateExtensionEndTime(currentEnd, 'mañana por la tarde', NOW)).toBeNull();
    expect(validateExtensionEndTime(currentEnd, '', NOW)).toBeNull();
  });

  test('TC-11 returns null when the new end equals the current end', () => {
    expect(validateExtensionEndTime(currentEnd, iso('10:00'), NOW)).toBeNull();
  });

  test('TC-12 returns null when the new end is earlier than the current end', () => {
    expect(validateExtensionEndTime(currentEnd, iso('09:30'), NOW)).toBeNull();
  });

  test('TC-19 returns null when the requested end is not after the current time', () => {
    // The reservation already ended (08:00) and the request (08:30) is still in the past.
    expect(validateExtensionEndTime(at('08:00'), iso('08:30'), NOW)).toBeNull();
  });
});

describe('isReservationExtendable (pure rule)', () => {
  test('TC-01 allows an ACTIVE reservation that has not ended', () => {
    expect(isReservationExtendable('ACTIVE', at('10:00'), NOW)).toBe(true);
  });

  test('TC-06 rejects a CANCELLED reservation', () => {
    expect(isReservationExtendable('CANCELLED', at('10:00'), NOW)).toBe(false);
  });

  test('TC-07 rejects an ACTIVE reservation whose end time already passed', () => {
    expect(isReservationExtendable('ACTIVE', at('08:30'), NOW)).toBe(false);
  });

  test('TC-19 rejects an ACTIVE reservation that ends exactly now', () => {
    expect(isReservationExtendable('ACTIVE', at('09:00'), NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Service (Reservation model is replaced with spies: no database needed)
// ---------------------------------------------------------------------------
describe('extendReservation (service)', () => {
  beforeEach(() => {
    // Only Date is faked, so promises and timers keep working normally.
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'nextTick', 'setImmediate', 'clearImmediate', 'setInterval',
        'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask'
      ]
    });
    jest.spyOn(Reservation, 'findById').mockResolvedValue(null as never);
    jest.spyOn(Reservation, 'find').mockResolvedValue([] as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function given(reservation: ReturnType<typeof makeReservation> | null, others: unknown[] = []) {
    jest.spyOn(Reservation, 'findById').mockResolvedValue(reservation as never);
    jest.spyOn(Reservation, 'find').mockResolvedValue(others as never);
  }

  async function expectRejected(
    promise: Promise<unknown>,
    status: number,
    reservation?: ReturnType<typeof makeReservation>
  ) {
    await expect(promise).rejects.toBeInstanceOf(reservationService.ReservationError);
    await expect(promise).rejects.toMatchObject({ status });
    if (reservation) {
      // A rejected request must not change or persist anything.
      expect(reservation.save).not.toHaveBeenCalled();
      expect(reservation.endTime).toEqual(at('10:00'));
    }
  }

  test('TC-01 updates endTime, persists it and returns the reservation', async () => {
    // Arrange
    const r1 = makeReservation();
    given(r1);

    // Act
    const result = await reservationService.extendReservation(String(r1._id), iso('10:30'));

    // Assert
    expect(result).toBe(r1);
    expect(r1.endTime).toEqual(at('10:30'));
    expect(r1.save).toHaveBeenCalledTimes(1);
  });

  test('TC-02 extends when a later reservation exists but is not reached', async () => {
    const r1 = makeReservation();
    given(r1, []); // the database query returns nothing overlapping 08:00-10:45

    const result = await reservationService.extendReservation(String(r1._id), iso('10:45'));

    expect(result.endTime).toEqual(at('10:45'));
    expect(r1.save).toHaveBeenCalledTimes(1);
  });

  test('TC-04 answers not found for a malformed id without querying the database', async () => {
    await expectRejected(reservationService.extendReservation('abc123', iso('10:30')), 404);

    expect(Reservation.findById).not.toHaveBeenCalled();
  });

  test('TC-05 answers not found when the reservation does not exist', async () => {
    given(null);

    await expectRejected(
      reservationService.extendReservation(String(new Types.ObjectId()), iso('10:30')),
      404
    );
  });

  test('TC-06 answers conflict when the reservation is CANCELLED', async () => {
    const r1 = makeReservation({ status: 'CANCELLED' });
    given(r1);

    await expectRejected(reservationService.extendReservation(String(r1._id), iso('10:30')), 409, r1);
  });

  test('TC-07 answers conflict when the reservation already ended', async () => {
    const r1 = makeReservation({ startTime: at('07:00'), endTime: at('08:30') });
    given(r1);

    const promise = reservationService.extendReservation(String(r1._id), iso('10:00'));

    await expectRejected(promise, 409);
    expect(r1.save).not.toHaveBeenCalled();
    expect(r1.endTime).toEqual(at('08:30'));
  });

  test('TC-08 answers bad request when the new end time is missing', async () => {
    const r1 = makeReservation();
    given(r1);

    await expectRejected(reservationService.extendReservation(String(r1._id), undefined), 400, r1);
  });

  test('TC-09 answers bad request when the new end time is not a string', async () => {
    const r1 = makeReservation();
    given(r1);

    await expectRejected(
      reservationService.extendReservation(String(r1._id), at('10:30').getTime()),
      400,
      r1
    );
  });

  test('TC-10 answers bad request when the new end time is not a date', async () => {
    const r1 = makeReservation();
    given(r1);

    await expectRejected(
      reservationService.extendReservation(String(r1._id), 'mañana por la tarde'),
      400,
      r1
    );
  });

  test('TC-11 answers bad request when the new end equals the current end', async () => {
    const r1 = makeReservation();
    given(r1);

    await expectRejected(reservationService.extendReservation(String(r1._id), iso('10:00')), 400, r1);
  });

  test('TC-12 answers bad request when the new end is earlier than the current end', async () => {
    const r1 = makeReservation();
    given(r1);

    await expectRejected(reservationService.extendReservation(String(r1._id), iso('09:30')), 400, r1);
  });

  test('TC-13 answers conflict when the extension overlaps another ACTIVE reservation', async () => {
    const r1 = makeReservation();
    given(r1, [makeOther(r1.parkingSpotId)]);

    await expectRejected(reservationService.extendReservation(String(r1._id), iso('11:30')), 409, r1);
  });

  test('TC-14 answers conflict when the extension fully covers another reservation', async () => {
    const r1 = makeReservation();
    given(r1, [makeOther(r1.parkingSpotId)]);

    await expectRejected(reservationService.extendReservation(String(r1._id), iso('13:00')), 409, r1);
  });

  test('TC-15 lets unexpected persistence errors propagate without saving', async () => {
    const r1 = makeReservation();
    given(r1);
    jest.spyOn(Reservation, 'find').mockRejectedValue(new Error('db down') as never);

    const promise = reservationService.extendReservation(String(r1._id), iso('10:30'));

    await expect(promise).rejects.toThrow('db down');
    await expect(promise).rejects.not.toBeInstanceOf(reservationService.ReservationError);
    expect(r1.save).not.toHaveBeenCalled();
  });

  test('TC-16 allows an extension that ends exactly when another reservation starts', async () => {
    const r1 = makeReservation();
    // Even if the database handed back the adjacent reservation, it is not a conflict.
    given(r1, [makeOther(r1.parkingSpotId)]);

    const result = await reservationService.extendReservation(String(r1._id), iso('11:00'));

    expect(result.endTime).toEqual(at('11:00'));
    expect(r1.save).toHaveBeenCalledTimes(1);
  });

  test('TC-17 only looks for ACTIVE reservations, so CANCELLED ones never block', async () => {
    const r1 = makeReservation();
    given(r1, []); // the CANCELLED reservation is filtered out by the query

    const result = await reservationService.extendReservation(String(r1._id), iso('11:30'));

    expect(Reservation.find).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }));
    expect(result.endTime).toEqual(at('11:30'));
  });

  test('TC-18 excludes the reservation being extended from the conflict query', async () => {
    const r1 = makeReservation();
    given(r1);

    await reservationService.extendReservation(String(r1._id), iso('10:30'));

    expect(Reservation.find).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { $ne: r1._id } })
    );
  });

  test('TC-19 answers conflict when the reservation ends exactly now', async () => {
    const r1 = makeReservation({ startTime: at('08:00'), endTime: at('09:00') });
    given(r1);

    const promise = reservationService.extendReservation(String(r1._id), iso('10:00'));

    await expectRejected(promise, 409);
    expect(r1.save).not.toHaveBeenCalled();
  });

  test('TC-20 limits the conflict query to the same parking spot', async () => {
    const r1 = makeReservation();
    given(r1);

    await reservationService.extendReservation(String(r1._id), iso('11:30'));

    expect(Reservation.find).toHaveBeenCalledWith(
      expect.objectContaining({ parkingSpotId: r1.parkingSpotId })
    );
  });

  test('TC-21 persists a one-minute extension', async () => {
    const r1 = makeReservation();
    given(r1);

    const result = await reservationService.extendReservation(String(r1._id), iso('10:01'));

    expect(result.endTime).toEqual(at('10:01'));
    expect(r1.save).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Route: PATCH /api/reservations/:id/extend (service replaced with a spy)
// ---------------------------------------------------------------------------
describe('PATCH /api/reservations/:id/extend (route)', () => {
  let server: Server;
  let baseUrl: string;
  const id = String(new Types.ObjectId());

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function patch(body: unknown) {
    return fetch(`${baseUrl}/api/reservations/${id}/extend`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  test('TC-01 responds 200 with the updated reservation and forwards the body value', async () => {
    const spy = jest
      .spyOn(reservationService, 'extendReservation')
      .mockResolvedValue({ _id: id, endTime: iso('10:30'), status: 'ACTIVE' } as never);

    const response = await patch({ endTime: iso('10:30') });
    const body = (await response.json()) as { endTime: string };

    expect(response.status).toBe(200);
    expect(body.endTime).toBe(iso('10:30'));
    expect(spy).toHaveBeenCalledWith(id, iso('10:30'));
  });

  test('TC-08 responds 400 when the service rejects the schedule data', async () => {
    jest
      .spyOn(reservationService, 'extendReservation')
      .mockRejectedValue(new reservationService.ReservationError(400, 'Invalid end time'));

    const response = await patch({});

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ message: 'Invalid end time' });
  });

  test('TC-05 responds 404 when the reservation is not found', async () => {
    jest
      .spyOn(reservationService, 'extendReservation')
      .mockRejectedValue(new reservationService.ReservationError(404, 'Reservation not found'));

    const response = await patch({ endTime: iso('10:30') });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: 'Reservation not found' });
  });

  test('TC-13 responds 409 when the extension is rejected by a business rule', async () => {
    jest
      .spyOn(reservationService, 'extendReservation')
      .mockRejectedValue(
        new reservationService.ReservationError(409, 'Parking spot is not available for this time range')
      );

    const response = await patch({ endTime: iso('11:30') });

    expect(response.status).toBe(409);
  });

  test('TC-15 responds 500 with a generic message on unexpected errors', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(reservationService, 'extendReservation').mockRejectedValue(new Error('db down'));

    const response = await patch({ endTime: iso('10:30') });
    const body = (await response.json()) as { message: string };

    expect(response.status).toBe(500);
    expect(body.message).not.toContain('db down');
  });
});
