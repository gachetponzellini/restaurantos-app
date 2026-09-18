-- #350 — «Mercado Pago» que sólo registra.
--
-- El local cobra MP por fuera (la app, el QR fijo del mostrador) y en el sistema
-- sólo quiere dejar asentado que entró por MP. `mp_link`/`mp_qr` no sirven: abren
-- el flujo real y la anulación los trata como plata que confirmó Mercado Pago.
-- `mp_manual` se comporta como `card_manual`: se elige, se confirma, se corrige.
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method = any (array['cash','card_manual','mp_link','mp_qr','mp_manual',
                             'transfer','other','cuenta_corriente']));

-- La cobranza de una cuenta corriente también puede entrar por MP.
alter table public.customer_credit_settlements
  drop constraint if exists customer_credit_settlements_method_check;
alter table public.customer_credit_settlements
  add constraint customer_credit_settlements_method_check
  check (method in ('cash','transfer','card_manual','mp_manual','other'));
