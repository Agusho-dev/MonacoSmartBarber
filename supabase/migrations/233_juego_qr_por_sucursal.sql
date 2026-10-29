-- 233: interruptor por sucursal del QR de «Corte Final» en el kiosko (29/oct/2026).
--
-- El dueño pidió que el QR del juego no se vea todavía en la tablet del check-in. El kiosko
-- sólo lo muestra si crearEnlaceJuego (src/lib/actions/juego.ts) devuelve el link, y esa
-- action ahora exige esta marca en la sucursal de la entrada: apagada, no hay QR y el cartel
-- de éxito vuelve al reinicio de 5 s. Como lo decide el servidor, vale también para las
-- tablets que todavía tienen el bundle anterior (Known Risk #38).
--
-- Default FALSE: nace apagado en todas. Prenderlo en una sucursal es un UPDATE, sin deploy:
--   UPDATE public.branches SET juego_qr_kiosko = true WHERE slug = 'rondeau';
-- El juego en sí (/juego) sigue abierto para quien tenga el link.

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS juego_qr_kiosko boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.branches.juego_qr_kiosko IS
  'Muestra el QR de «Corte Final» (/juego) en el kiosko de check-in de esta sucursal. Lo lee crearEnlaceJuego con service role.';
