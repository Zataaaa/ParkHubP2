# Diseño de casos de prueba: extender reservación

Definidos **antes** de implementar la feature.

**Datos base:** Reloj fijo: ahora = 2026-11-01 09:00Z. R1 = reservación ACTIVE del espacio A01, 08:00–10:00 (en curso). R2 = otra reservación ACTIVE del mismo espacio, 11:00–12:00.

| ID | Nombre | Precondiciones | Entrada | Pasos | Resultado esperado | Tipo |
|---|---|---|---|---|---|---|
| TC-01 | Extensión válida simple | R1 ACTIVE y vigente; no existen otras reservaciones en el espacio. | PATCH /api/reservations/{R1}/extend  {"endTime":"2026-11-01T10:30:00.000Z"} | 1) Localizar R1. 2) Verificar ACTIVE y vigente. 3) Validar fecha. 4) Consultar conflictos. 5) Guardar. | 200. Devuelve R1 con endTime = 10:30. save() se invoca una vez. | Happy Path |
| TC-02 | Extensión válida con reservación posterior que no estorba | R1 ACTIVE vigente; R2 ACTIVE 11:00–12:00 en el mismo espacio. | endTime = 10:45 | Igual que TC-01; la consulta de conflictos devuelve vacío porque 10:45 < 11:00. | 200. endTime = 10:45 persistido; R2 no se toca. | Happy Path |
| TC-03 | Fecha ISO con zona horaria explícita | R1 ACTIVE y vigente. | endTime = "2026-11-01T04:30:00-06:00" (equivale a 10:30Z) | La regla pura parsea el texto con Date. | La regla devuelve la fecha 10:30Z; el flujo responde 200. | Happy Path |
| TC-04 | ID con formato inválido | Ninguna. | PATCH /api/reservations/abc123/extend | El Service valida el ObjectId antes de consultar MongoDB. | 404 (reservación no localizable). No se consulta la base de datos. | Error Case |
| TC-05 | ID válido pero inexistente | No existe una reservación con ese _id. | PATCH /api/reservations/{ObjectId inexistente}/extend | findById devuelve null. | 404 "Reservation not found". No se guarda nada. | Error Case |
| TC-06 | Reservación cancelada no se puede extender | R1 con status CANCELLED. | endTime = 10:30 | El Service revisa el estado antes de validar la fecha. | 409. R1 no se modifica (save() no se invoca). | Error Case |
| TC-07 | Reservación ya finalizada | R1 ACTIVE con endTime = 08:30 (anterior a ahora, 09:00). | endTime = 10:00 | El Service compara endTime actual contra la hora del sistema. | 409. R1 no se modifica. | Error Case |
| TC-08 | Nueva hora final ausente | R1 ACTIVE y vigente. | Cuerpo sin endTime (undefined) | La regla pura rechaza valores que no son texto. | 400. R1 no se modifica. | Error Case |
| TC-09 | Nueva hora final con tipo incorrecto | R1 ACTIVE y vigente. | endTime = 1793527800000 (número) / null / objeto | La regla exige string. | 400. R1 no se modifica. | Error Case |
| TC-10 | Nueva hora final con texto que no es fecha | R1 ACTIVE y vigente. | endTime = "mañana por la tarde" | new Date(texto) produce Invalid Date. | 400. R1 no se modifica. | Error Case |
| TC-11 | Nueva hora final igual a la actual | R1 ACTIVE y vigente (endTime 10:00). | endTime = 10:00 | La nueva hora debe ser ESTRICTAMENTE posterior. | 400. R1 no se modifica. | Error Case |
| TC-12 | Nueva hora final anterior a la actual | R1 ACTIVE y vigente (endTime 10:00). | endTime = 09:30 | La regla compara contra currentEnd. | 400. R1 no se modifica. | Error Case |
| TC-13 | Conflicto parcial con otra reservación ACTIVE | R1 vigente; R2 ACTIVE 11:00–12:00 en el mismo espacio. | endTime = 11:30 | La consulta devuelve R2 y hasTimeConflict(08:00, 11:30, 11:00, 12:00) = true. | 409. R1 no se modifica. | Error Case |
| TC-14 | La extensión envuelve por completo a otra reservación | R1 vigente; R2 ACTIVE 11:00–12:00. | endTime = 13:00 | R2 queda totalmente dentro del nuevo rango. | 409. R1 no se modifica. | Error Case |
| TC-15 | Falla inesperada de persistencia | La consulta a MongoDB lanza un error. | endTime = 10:30 | El error no es ReservationError; la ruta lo captura. | 500 con mensaje genérico; no se filtra el error interno. | Error Case |
| TC-16 | Reservaciones adyacentes (termina cuando la otra empieza) | R1 vigente; R2 ACTIVE 11:00–12:00. | endTime = 11:00 | hasTimeConflict(08:00, 11:00, 11:00, 12:00) = false (límites abiertos). | 200. endTime = 11:00 persistido. | Edge Case |
| TC-17 | Reservación CANCELLED en el rango no bloquea | R1 vigente; existe R3 CANCELLED 11:00–12:00 en el mismo espacio. | endTime = 11:30 | La consulta de conflictos filtra status = ACTIVE, por lo que R3 no aparece. | 200. endTime = 11:30 persistido. | Edge Case |
| TC-18 | La reservación no choca consigo misma | R1 vigente (su rango original 08:00–10:00 se traslapa con el nuevo 08:00–10:30). | endTime = 10:30 | La consulta excluye el propio _id ({ $ne: R1._id }). | 200. La consulta incluye la exclusión del _id. | Edge Case |
| TC-19 | La reservación termina exactamente ahora | R1 ACTIVE con endTime = 09:00 (= ahora). | endTime = 10:00 | Vigente significa endTime > ahora (estricto). | 409. R1 no se modifica. | Edge Case |
| TC-20 | Solo cuentan reservaciones del mismo espacio | R1 en A01; otra reservación ACTIVE 11:00–12:00 pero en el espacio B01. | endTime = 11:30 | La consulta filtra por parkingSpotId de R1, por lo que la de B01 no aparece. | 200. La consulta incluye el parkingSpotId de R1. | Edge Case |
| TC-21 | Extensión mínima de un minuto | R1 vigente (endTime 10:00). | endTime = 10:01 | Límite inferior: estrictamente posterior por un minuto. | 200. endTime = 10:01 persistido. | Edge Case |
