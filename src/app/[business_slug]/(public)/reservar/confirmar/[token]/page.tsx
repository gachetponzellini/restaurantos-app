import { revalidatePath } from "next/cache";

import {
  confirmReservationAttendance,
  getReservationByConfirmToken,
} from "@/lib/reservations/confirm-attendance-action";

/**
 * Página de confirmación de asistencia a una reserva (double opt-in, spec 45).
 * El link llega por el recordatorio de email. La confirmación se hace por POST
 * (form action), no en el GET, para no confirmar por prefetch de clientes de
 * correo.
 */
export default async function ConfirmarReservaPage({
  params,
}: {
  params: Promise<{ business_slug: string; token: string }>;
}) {
  const { business_slug, token } = await params;
  const reservation = await getReservationByConfirmToken(token, business_slug);

  async function confirm() {
    "use server";
    await confirmReservationAttendance(token, business_slug);
    revalidatePath(`/${business_slug}/reservar/confirmar/${token}`);
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      {!reservation ? (
        <p className="text-muted-foreground">
          Este link no es válido o ya expiró.
        </p>
      ) : (
        <>
          <h1 className="text-xl font-semibold">{reservation.businessName}</h1>
          <p className="text-muted-foreground">
            Reserva para {reservation.partySize}{" "}
            {reservation.partySize === 1 ? "persona" : "personas"} ·{" "}
            {reservation.whenLabel}
          </p>

          {reservation.alreadyConfirmed ? (
            <p className="font-medium text-green-600">
              ¡Listo! Ya confirmaste tu asistencia. Te esperamos 🙌
            </p>
          ) : reservation.status !== "confirmed" &&
            reservation.status !== "seated" ? (
            <p className="text-muted-foreground">
              Esta reserva ya no está activa.
            </p>
          ) : (
            <form action={confirm}>
              <button
                type="submit"
                className="rounded-lg bg-foreground px-5 py-3 font-semibold text-background"
              >
                Confirmar asistencia
              </button>
            </form>
          )}
        </>
      )}
    </main>
  );
}
