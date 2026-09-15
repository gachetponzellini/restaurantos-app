"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ArrowLeft, Loader2, RotateCw, ScanLine } from "lucide-react";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { createSupplierInvoice, crearProveedorDesdeLectura } from "@/lib/proveedores/actions";
import { aprenderAliases } from "@/lib/proveedores/actions-client";
import { calcularVencimiento, etiquetaTipo } from "@/lib/proveedores/cuenta-corriente";
import { hoyAR } from "@/lib/proveedores/fechas-ar";
import {
  baseDelComprobante,
  conciliarPie,
  tasaDelPie,
  TASA_POR_DEFECTO,
} from "@/lib/proveedores/iva";
import { condicionDePagoLeida } from "@/lib/proveedores/lectura/condicion-pago";
import { parseFechaAR } from "@/lib/proveedores/lectura/fecha-ar";
import { parseNumeroAR } from "@/lib/proveedores/lectura/numeros-ar";
import {
  DOCUMENT_TYPES,
  RUBRO_LABELS,
  SUPPLIER_PAYMENT_METHODS,
  SupplierInvoiceInput,
  type ExpenseRubro,
  type SupplierInvoiceItemInput,
} from "@/lib/proveedores/schema";
import {
  BandaProveedor,
  SelectorBuscable,
  type CandidatoProveedor,
  type EstadoProveedor,
} from "@/components/admin/proveedores/banda-proveedor";
import {
  InvoicePhotosUploader,
  useFotosComprobante,
} from "@/components/admin/proveedores/invoice-photos-uploader";
import {
  RevisionLectura,
  type AliasAprendido,
  type RenglonRevisable,
} from "@/components/admin/proveedores/revision-lectura";
import { RenglonesEditor, type InsumoOption } from "@/components/admin/proveedores/renglones-editor";

export type ProveedorDelNegocio = {
  id: string;
  name: string;
  cuit: string | null;
  defaultExpenseConceptId: string | null;
  paymentTermsDays: number;
};

export type ConceptoDelNegocio = { id: string; name: string; rubro: string };

type FormValues = z.input<typeof SupplierInvoiceInput>;
type TipoComprobante = (typeof DOCUMENT_TYPES)[number];

/** Qué campo llenó la máquina, y de dónde lo sacó. */
type Origen = "foto" | "proveedor";

/**
 * Los tipos que dice el modelo NO son los que guarda la app.
 *
 * El modelo puede decir `otro`, que acá no existe; y la app tiene `interno` —el
 * `Z` de MaxiRest, la compra diaria sin comprobante—, que el modelo no puede
 * decir porque no hay papel que diga «interno». Lo que no está en este mapa se
 * deja como viene el formulario: `interno`, que es el default y el 36% de las
 * compras del Golf. Inventar un tipo no es gratis — decide si se pide el número
 * y si el importe tiene que ir en negativo.
 */
const TIPO_DEL_MODELO: Record<string, TipoComprobante> = {
  factura_a: "factura_a",
  factura_b: "factura_b",
  factura_c: "factura_c",
  ticket: "ticket",
  remito: "remito",
  nota_credito: "nota_credito",
  nota_debito: "nota_debito",
};

/** El importe de la cabecera, de texto impreso a centavos. `null` si no se leyó. */
function parsearImporte(raw: string | null | undefined): number | null {
  const n = parseNumeroAR(raw ?? null);
  return n === null ? null : Math.round(n * 100);
}

/**
 * Cuánto se espera antes de leer — spec 173.
 *
 * Las fotos de un ticket largo se sueltan de a varias y terminan de subir en
 * cualquier orden. Sin esta espera, la primera que aterriza dispara una lectura
 * de una sola página y la segunda dispara otra de dos: se paga el doble y la
 * cabecera se arma con la mitad del papel.
 */
const ESPERA_ANTES_DE_LEER_MS = 1200;

type CabeceraLeida = {
  proveedor_nombre: string | null;
  proveedor_cuit: string | null;
  tipo_comprobante: string | null;
  numero: string | null;
  fecha: string | null;
  total: string | null;
  origen_total: string | null;
  /** spec 187 · lo que dice el pie sobre cómo se paga, verbatim. */
  condicion_pago?: string | null;
  /** spec 188 · el pie fiscal, verbatim. */
  neto?: string | null;
  iva?: string | null;
  percepciones?: string | null;
};

type RespuestaLectura = {
  esComprobante: boolean;
  motivoDescarte: string | null;
  cabecera: CabeceraLeida | null;
  /** La fecha de la cabecera ya parseada, «YYYY-MM-DD» o null. */
  fechaISO?: string | null;
  proveedor?: {
    estado: EstadoProveedor;
    supplierId: string | null;
    candidatos: CandidatoProveedor[];
    nombreLeido: string | null;
    cuitLeido: string | null;
  } | null;
  renglones: RenglonRevisable[];
  paginasFallidas?: { pagina: number; error: string }[];
};

/** El sello de «esto lo llenó la máquina». Discreto: informa, no grita. */
/** Los mismos nombres que el diálogo de pago: es la misma operación. */
const METODOS: Record<(typeof SUPPLIER_PAYMENT_METHODS)[number], string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card_manual: "Tarjeta",
  other: "Otro",
};

function Autollenado({ origen }: { origen: Origen }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-zinc-400">
      <ScanLine className="size-3" />
      {origen === "foto" ? "de la foto" : "del proveedor"}
    </span>
  );
}

/**
 * Cargar una compra — spec 173.
 *
 * Es el diálogo de 384 px convertido en pantalla. Los cinco pedidos del dueño
 * están acá: la foto grande a la izquierda y quieta (1 y 4), el proveedor y el
 * concepto buscables desde un botón general (2 y 3), y hasta cinco páginas por
 * compra porque «a veces los tickets son muy largos» (5).
 *
 * **La regla que ordena todo lo demás: la máquina no pisa lo que escribió una
 * persona.** La lectura tarda 15-40 s y el foco arranca en Importe, así que
 * mientras el modelo piensa la encargada ya está tipeando. El diálogo viejo
 * hacía `setValue` incondicional: te cambiaba abajo el número que acababas de
 * poner, sin decir nada. Acá cada campo se escribe sólo si nadie lo tocó, y lo
 * que llenó la máquina queda marcado.
 */
export function CargarCompraClient({
  slug,
  businessId,
  proveedores,
  conceptos,
  insumos,
  proveedorFijadoId,
}: {
  slug: string;
  businessId: string;
  proveedores: ProveedorDelNegocio[];
  conceptos: ConceptoDelNegocio[];
  insumos: InsumoOption[];
  /** Viene de `?proveedor=<id>`: se entró desde la ficha del proveedor. */
  proveedorFijadoId: string | null;
}) {
  const router = useRouter();
  const fotos = useFotosComprobante({ businessId });

  const [submitting, setSubmitting] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [items, setItems] = useState<SupplierInvoiceItemInput[]>([]);
  const [leido, setLeido] = useState<RenglonRevisable[] | null>(null);
  /**
   * Qué renglones de `items` los puso la lectura. Lo que NO está acá lo cargó
   * una persona a mano, y eso no se pisa nunca. Va en un ref y no en estado
   * porque no se dibuja: sólo sirve para restar.
   */
  const itemsDeLaLectura = useRef<SupplierInvoiceItemInput[]>([]);
  /**
   * Cuántas lecturas van. Es la `key` de la revisión: `RevisionLectura` copia
   * los renglones a estado propio en el primer render, así que una segunda
   * lectura —«Leer de nuevo», o una página que se agrega— dejaba en pantalla
   * las filas de la anterior con los renglones nuevos ya en la respuesta.
   */
  const [lecturaId, setLecturaId] = useState(0);
  const [aprender, setAprender] = useState<AliasAprendido[]>([]);
  const [autollenados, setAutollenados] = useState<Record<string, Origen | undefined>>({});
  /**
   * Los proveedores que aparecieron después de cargar la página: el que se creó
   * desde la banda, y el que la lectura resolvió pero no estaba en la lista
   * (uno dado de baja, por ejemplo). Sin esto el selector muestra vacío con un
   * `supplier_id` puesto, que es la peor de las dos cosas.
   */
  const [extras, setExtras] = useState<ProveedorDelNegocio[]>([]);
  const [proveedorLeido, setProveedorLeido] = useState<{
    estado: EstadoProveedor;
    candidatos: CandidatoProveedor[];
    nombreLeido: string | null;
    cuitLeido: string | null;
  }>({ estado: "sin_foto", candidatos: [], nombreLeido: null, cuitLeido: null });

  const today = hoyAR();
  const fijado = proveedores.find((p) => p.id === proveedorFijadoId) ?? null;

  const form = useForm<FormValues>({
    resolver: zodResolver(SupplierInvoiceInput),
    defaultValues: {
      supplier_id: fijado?.id ?? "",
      invoice_number: "",
      invoice_date: today,
      total_cents: 0,
      photo_url: null,
      photo_urls: [],
      notes: "",
      // El 36% de las compras del Golf no tienen factura: el caso frecuente es
      // el default, no el que hay que ir a elegir.
      document_type: "interno",
      expense_concept_id: fijado?.defaultExpenseConceptId ?? null,
      due_date: calcularVencimiento(today, fijado?.paymentTermsDays ?? 0),
      // spec 187 · el default no cambia: la compra nace debiendo salvo que
      // alguien diga lo contrario. Lo que cambia es que decirlo son dos clicks.
      payment_condition: "cuenta_corriente",
      payment_method: "cash",
      // spec 188 · vacío, nunca cero: un IVA en 0 sobre una factura A es la
      // declaración de que la compra fue exenta, no un dato faltante.
      neto_cents: null,
      iva_cents: null,
      percepciones_cents: null,
    },
  });

  /**
   * Qué campos tocó una persona. Es un ref y no estado a propósito: la lectura
   * vuelve de un `await` y tiene que preguntar por lo que pasó MIENTRAS corría,
   * no por lo que era verdad en el render en que arrancó.
   *
   * Se consulta además `dirtyFields` de react-hook-form, por si algún campo se
   * escribe por un camino que no pasa por estos `onChange`.
   */
  const tocados = useRef(new Set<string>());
  const { dirtyFields } = form.formState;
  const dirtyRef = useRef(dirtyFields);
  dirtyRef.current = dirtyFields;

  const estaLibre = (campo: keyof FormValues) =>
    !tocados.current.has(campo) && !dirtyRef.current[campo];

  const marcarTocado = (campo: keyof FormValues) => {
    tocados.current.add(campo);
    setAutollenados((prev) => (prev[campo] ? { ...prev, [campo]: undefined } : prev));
  };

  const escribirSiLibre = (campo: keyof FormValues, valor: unknown, origen: Origen) => {
    if (!estaLibre(campo)) return false;
    form.setValue(campo, valor as never, { shouldDirty: false });
    setAutollenados((prev) => ({ ...prev, [campo]: origen }));
    return true;
  };

  const proveedorId = form.watch("supplier_id");
  const fecha = form.watch("invoice_date");
  const tipo = form.watch("document_type") as TipoComprobante;
  const totalCents = Number(form.watch("total_cents")) || 0;

  /**
   * El importe, como texto. El form guarda centavos; esto guarda lo que la
   * persona ve mientras escribe, para no reformatearle el número abajo del
   * dedo (tipear «1.2» y que se convierta en «1,20» a mitad de camino es la
   * forma más rápida de que alguien cargue mal una factura).
   *
   * Se re-sincroniza SÓLO cuando el valor del form dejó de coincidir con lo
   * tecleado, o sea cuando lo escribió otro: el lector.
   */
  const [importeTexto, setImporteTexto] = useState("");
  useEffect(() => {
    const tecleado = parseNumeroAR(importeTexto);
    const tecleadoCents = tecleado === null ? 0 : Math.round(tecleado * 100);
    if (tecleadoCents === totalCents) return;
    setImporteTexto(totalCents ? String(totalCents / 100).replace(".", ",") : "");
  }, [totalCents, importeTexto]);
  const conNumero = tipo !== "interno";

  /**
   * El pie fiscal — spec 188.
   *
   * Tres campos de texto con su estado propio, como el importe: `type="number"`
   * no entiende cómo se escribe la plata acá («2.045.661,16» le da vacío) y el
   * `|| 0` de un parseo fallido escribiría un CERO donde la persona no puso
   * nada. En estas tres columnas eso es peor que en el total: un `iva_cents = 0`
   * sobre una factura A dice «esta compra fue exenta».
   */
  const [pieTexto, setPieTexto] = useState({ neto: "", iva: "", percepciones: "" });

  const escribirPie = (campo: "neto" | "iva" | "percepciones", texto: string) => {
    setPieTexto((prev) => ({ ...prev, [campo]: texto }));
    const pesos = parseNumeroAR(texto);
    const campoForm = (
      { neto: "neto_cents", iva: "iva_cents", percepciones: "percepciones_cents" } as const
    )[campo];
    marcarTocado(campoForm);
    form.setValue(campoForm, pesos === null ? null : Math.round(pesos * 100), {
      shouldDirty: true,
    });
  };

  const netoCents = (form.watch("neto_cents") as number | null) ?? null;
  const ivaCents = (form.watch("iva_cents") as number | null) ?? null;
  const percepcionesCents = (form.watch("percepciones_cents") as number | null) ?? null;

  /**
   * Sólo la factura A discrimina IVA (188·D2). Sobre un ticket o una compra sin
   * comprobante, pedir el neto sería pedir que se invente: el precio del papel
   * ya es el final y no hay crédito fiscal que separar.
   */
  const discrimina = baseDelComprobante(tipo) === "neto";

  const pie = conciliarPie({
    netoCents,
    ivaCents,
    percepcionesCents,
    totalCents,
  });

  /** La tasa que heredan los renglones sin tasa impresa. Sólo para mostrar (D5). */
  const tasaComprobante = discrimina ? (tasaDelPie(netoCents, ivaCents) ?? TASA_POR_DEFECTO) : null;

  const todosLosProveedores = useMemo(
    () => [...proveedores, ...extras],
    [proveedores, extras],
  );
  const proveedorSel = todosLosProveedores.find((p) => p.id === proveedorId) ?? null;
  const plazo = proveedorSel?.paymentTermsDays ?? 0;

  // El vencimiento sigue a la fecha mientras nadie lo toque a mano: cambiar la
  // fecha de la factura y quedarse con el vencimiento viejo es un impago que
  // aparece a destiempo en la lista.
  useEffect(() => {
    if (!fecha || !estaLibre("due_date")) return;
    form.setValue("due_date", calcularVencimiento(fecha, plazo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fecha, plazo]);

  // El concepto lo pone el proveedor (spec 158). Al resolverlo desde la foto,
  // esto es lo que evita que el encargado elija el mismo concepto diez veces
  // por día.
  useEffect(() => {
    if (!proveedorSel || !estaLibre("expense_concept_id")) return;
    const anterior = form.getValues("expense_concept_id") ?? null;
    const nuevo = proveedorSel.defaultExpenseConceptId ?? null;
    if (anterior === nuevo) return;
    form.setValue("expense_concept_id", nuevo);
    setAutollenados((prev) => ({ ...prev, expense_concept_id: nuevo ? "proveedor" : undefined }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorSel]);

  /** Elegir proveedor a mano, desde el buscador o desde un candidato. */
  const elegirProveedor = (id: string | null) => {
    marcarTocado("supplier_id");
    if (id && !todosLosProveedores.some((p) => p.id === id)) {
      const cand = proveedorLeido.candidatos.find((c) => c.id === id);
      if (cand) {
        setExtras((prev) => [
          ...prev,
          {
            id: cand.id,
            name: cand.name,
            cuit: cand.cuit,
            defaultExpenseConceptId: null,
            paymentTermsDays: 0,
          },
        ]);
      }
    }
    form.setValue("supplier_id", id ?? "", { shouldValidate: true });
  };

  const crearProveedor = async (nombre: string, cuit: string | null) => {
    const res = await crearProveedorDesdeLectura(slug, { nombre, cuit });
    if (!res.ok) {
      // El alta NO fusiona con un proveedor que ya existe, a propósito: mergear
      // dos proveedores a partir de un nombre que transcribió un modelo no
      // tiene deshacer. Que lo elija la persona del buscador.
      toast.error(res.error);
      return;
    }
    setExtras((prev) => [
      ...prev,
      {
        id: res.data.id,
        name: nombre.trim().slice(0, 100),
        cuit,
        defaultExpenseConceptId: null,
        paymentTermsDays: 0,
      },
    ]);
    marcarTocado("supplier_id");
    form.setValue("supplier_id", res.data.id, { shouldValidate: true });
    toast.success("Proveedor creado.");
    router.refresh();
  };

  // ── La lectura ────────────────────────────────────────────────

  /** Las rutas que ya se mandaron a leer: evita releer lo mismo en loop. */
  const yaLeidas = useRef("");
  /**
   * Qué compra se está cargando. Sube uno cada vez que se guarda.
   *
   * Es la guarda contra el fantasma: la lectura tarda 15-40 s y nada impide
   * guardar mientras corre (a veces ya se tipeó todo y la foto es sólo el
   * respaldo). Sin esto, la respuesta llega cuando el formulario ya se limpió
   * para la compra siguiente y la llena con los datos de la anterior —
   * importe, número y proveedor de OTRO comprobante, sin un solo error.
   */
  const sesion = useRef(0);
  /**
   * Los ids de las páginas que se mandaron a leer, EN EL ORDEN EN QUE SE
   * MANDARON. Es lo que traduce «página 3» de la respuesta a una foto del rail:
   * el lector numera sobre las rutas que le llegaron, y el rail puede tener
   * además una foto todavía subiendo o una que falló, así que los dos índices
   * no coinciden. Sin esta traducción, el chip «pág. 3» de un renglón abre la
   * foto equivocada — y el punto del chip es ir a mirar el papel.
   */
  const idsDeLaLectura = useRef<string[]>([]);

  /** Llevar el visor a la página de la lectura (1-based). */
  const irAPagina = (pagina: number) => {
    const id = idsDeLaLectura.current[pagina - 1];
    const idx = id ? fotos.paginas.findIndex((p) => p.id === id) : -1;
    fotos.setActiva(idx >= 0 ? idx : Math.max(0, pagina - 1));
  };

  const aplicarLectura = (data: RespuestaLectura, idsLeidos: string[]) => {
    const fallidas = data.paginasFallidas ?? [];
    const idDePagina = (n: number) => idsDeLaLectura.current[n - 1];
    fotos.marcarEstado(idsLeidos, "leida");
    // Cada página caída con SU motivo: con lecturas en paralelo, «falló» sin
    // decir cuál ni por qué no le sirve a nadie.
    fallidas.forEach((f) => {
      const id = idDePagina(f.pagina);
      if (id) fotos.marcarEstado([id], "error", f.error);
    });

    /**
     * `paginasFallidas` se mira ANTES que `esComprobante`.
     *
     * Con todas las páginas caídas, la unión devuelve `esComprobante: false` —
     * y eso NO significa «esto no es un comprobante», significa «no sabemos».
     * Decirle a alguien que su factura no es una factura porque se cayó la API
     * es el peor mensaje posible: sale a sacar otra foto que va a fallar igual.
     */
    if (fallidas.length > 0 && fallidas.length >= fotos.paths.length) {
      toast.error(
        "No pudimos leer las fotos — fue un problema nuestro, no de la foto. Cargá la compra a mano: las fotos ya quedaron guardadas.",
      );
      return;
    }
    if (fallidas.length > 0) {
      const cuales = fallidas.map((f) => f.pagina).join(", ");
      toast.warning(
        fallidas.length === 1
          ? `Página ${cuales}: ${fallidas[0].error} Lo de abajo sale del resto.`
          : `No pude leer las páginas ${cuales}. Lo de abajo sale del resto.`,
      );
    }

    if (!data.esComprobante) {
      toast.error(
        `Esto no parece un comprobante: ${data.motivoDescarte ?? "no se entiende"}.`,
      );
      return;
    }

    // ── Proveedor ──
    //
    // Sólo si al leer NO había proveedor elegido. Cuando se manda uno, el
    // endpoint contesta «resuelto» con ese mismo id (contrato 5: «si viene
    // supplierId, ese gana») — es un eco, no un reconocimiento, y pintarlo como
    // «lo reconocí de la foto» sería decir que el papel dice algo que nadie leyó.
    const prov = proveedorId ? null : (data.proveedor ?? null);
    if (prov) {
      setProveedorLeido({
        estado: prov.estado,
        candidatos: prov.candidatos ?? [],
        nombreLeido: prov.nombreLeido,
        cuitLeido: prov.cuitLeido,
      });
      // Sólo `resuelto` se auto-elige. Con dos candidatos NUNCA: el CUIT está
      // repetido en el catálogo real (golf-jcr: 71 bien formados, 69 distintos),
      // así que elegir por puntaje le escribe la compra al proveedor equivocado
      // y se descubre en la conciliación de fin de mes.
      // `!fijado`: si se entró desde la ficha de un proveedor, la foto no lo
      // cambia. Sin esta guarda la compra podría terminar en otra cuenta
      // corriente que la que se abrió a propósito — y `supplier_id` no cuenta
      // como «tocado» porque venía puesto desde el default.
      if (
        prov.estado === "resuelto" &&
        prov.supplierId &&
        !fijado &&
        estaLibre("supplier_id")
      ) {
        const cand = prov.candidatos?.find((c) => c.id === prov.supplierId);
        if (cand && !todosLosProveedores.some((p) => p.id === cand.id)) {
          setExtras((prev) => [
            ...prev,
            {
              id: cand.id,
              name: cand.name,
              cuit: cand.cuit,
              defaultExpenseConceptId: null,
              paymentTermsDays: 0,
            },
          ]);
        }
        form.setValue("supplier_id", prov.supplierId, { shouldDirty: false });
        setAutollenados((prev) => ({ ...prev, supplier_id: "foto" }));
      }
    }

    // ── Cabecera ──
    const cab = data.cabecera;
    if (cab) {
      const tipoLeido = cab.tipo_comprobante
        ? TIPO_DEL_MODELO[cab.tipo_comprobante]
        : undefined;
      if (tipoLeido) escribirSiLibre("document_type", tipoLeido, "foto");

      // El importe se precarga pero NUNCA se rellena con la suma de los
      // renglones (172·D2): si no se leyó, el campo queda vacío y el Zod frena.
      const total = parsearImporte(cab.total);
      if (total !== null) {
        // El signo lo manda el tipo que quedó puesto: la nota de crédito resta
        // del saldo y el Zod la exige en negativo.
        const tipoFinal = form.getValues("document_type") as TipoComprobante;
        const conSigno = tipoFinal === "nota_credito" ? -Math.abs(total) : total;
        escribirSiLibre("total_cents", conSigno, "foto");
      }
      if (cab.numero) escribirSiLibre("invoice_number", cab.numero, "foto");

      // `fechaISO` la parsea el endpoint con `parseFechaAR`, que devuelve null
      // ante la duda y NUNCA cae a hoy: una fecha inventada mueve el
      // vencimiento, o sea el día en que hay que pagar. El fallback local es
      // por si contesta el endpoint viejo, que no manda el campo.
      const fechaAR = data.fechaISO ?? parseFechaAR(cab.fecha);
      if (fechaAR) escribirSiLibre("invoice_date", fechaAR, "foto");

      /**
       * spec 187 · la condición de pago del pie.
       *
       * `condicionDePagoLeida` devuelve null cuando el texto no habla de pago:
       * ahí no se escribe nada y no aparece el chip de «lo llenó la foto». Y
       * `contado` sobre una nota de crédito no puede entrar —el Zod lo prohíbe
       * (187·D6)—, así que se mira el tipo que quedó puesto, no el leído.
       */
      /**
       * El pie fiscal — spec 188. Cada uno por separado y sólo si está libre:
       * el que no se leyó queda en null y el campo, vacío.
       */
      for (const [campo, crudo] of [
        ["neto", cab.neto],
        ["iva", cab.iva],
        ["percepciones", cab.percepciones],
      ] as const) {
        const cents = parsearImporte(crudo);
        const campoForm = (
          { neto: "neto_cents", iva: "iva_cents", percepciones: "percepciones_cents" } as const
        )[campo];
        if (cents === null || !estaLibre(campoForm)) continue;
        escribirSiLibre(campoForm, cents, "foto");
        setPieTexto((prev) => ({ ...prev, [campo]: String(cents / 100).replace(".", ",") }));
      }

      const cond = condicionDePagoLeida(cab.condicion_pago);
      const tipoPuesto = form.getValues("document_type") as TipoComprobante;
      if (cond && tipoPuesto !== "nota_credito") {
        if (escribirSiLibre("payment_condition", cond.condicion, "foto")) {
          escribirSiLibre("payment_method", cond.metodo, "foto");
        }
      }
    }

    setLeido(data.renglones ?? []);
    setLecturaId((n) => n + 1);
  };

  const leerFotos = async () => {
    const paths = fotos.paths;
    if (paths.length === 0 || leyendo) return;
    yaLeidas.current = paths.join("|");
    const miSesion = sesion.current;

    // El mismo orden que `paths`: `fotos.paths` sale de `fotos.paginas` filtrando
    // las que ya subieron, así que estas dos listas van casadas índice a índice.
    const idsLeidos = fotos.paginas.filter((p) => p.path).map((p) => p.id);
    idsDeLaLectura.current = idsLeidos;

    setLeyendo(true);
    fotos.marcarEstado(idsLeidos, "leyendo");
    try {
      const res = await fetch("/api/proveedores/leer-comprobante", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessSlug: slug,
          photoPaths: paths,
          // Una release más de compatibilidad: mientras el endpoint viejo siga
          // arriba, la compra de una sola foto se lee igual.
          ...(paths.length === 1 ? { photoPath: paths[0] } : null),
          supplierId: proveedorId || null,
        }),
      });
      const json = await res.json();
      if (miSesion !== sesion.current) return;
      if (!json.ok) {
        fotos.marcarEstado(idsLeidos, "lista");
        toast.error(json.error ?? "No pudimos leer el comprobante. Cargalo a mano.");
        return;
      }
      aplicarLectura(json.data as RespuestaLectura, idsLeidos);
    } catch {
      fotos.marcarEstado(idsLeidos, "lista");
      toast.error("No pudimos leer el comprobante. Cargalo a mano.");
    } finally {
      setLeyendo(false);
    }
  };

  /**
   * La lectura arranca sola: un botón que hay que descubrir y apretar es un
   * botón que no se aprieta, y la función queda invisible. Falle lo que falle,
   * las fotos ya quedaron subidas y el formulario manual sigue igual — el
   * lector es un acelerador, nunca una dependencia.
   *
   * El disparo va por un ref: si la función entrara en las dependencias del
   * efecto, cada render reiniciaría el temporizador y la lectura no arrancaría
   * nunca.
   */
  const leerRef = useRef(leerFotos);
  useEffect(() => {
    leerRef.current = leerFotos;
  });

  const firmaPaths = fotos.paths.join("|");
  const listasParaLeer = fotos.listasParaLeer;
  useEffect(() => {
    if (!listasParaLeer || leyendo) return;
    if (!firmaPaths || firmaPaths === yaLeidas.current) return;
    const t = setTimeout(() => void leerRef.current(), ESPERA_ANTES_DE_LEER_MS);
    return () => clearTimeout(t);
  }, [firmaPaths, listasParaLeer, leyendo]);

  // ── Guardar ───────────────────────────────────────────────────

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const paths = fotos.paths;
      const result = await createSupplierInvoice(slug, {
        ...values,
        photo_urls: paths,
        // La columna vieja sigue escribiéndose con la primera página: es la que
        // tiene el encabezado, y es la que ve quien todavía muestra una foto.
        photo_url: paths[0] ?? null,
        items,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // El aprendizaje va DESPUÉS de que el comprobante quedó: si la carga
      // falla, la action se anula sola (165·D3) y no se aprende nada. Y si el
      // alias falla, no se pierde plata — es una opinión, no un hecho contable.
      if (aprender.length > 0 && values.supplier_id) {
        aprenderAliases(businessId, values.supplier_id, aprender).catch(() => {});
      }
      const conInsumos =
        items.length > 0
          ? `Compra cargada con ${items.length} ${items.length === 1 ? "insumo" : "insumos"}. Subió el stock y se actualizó el costo.`
          : "Compra cargada. Podés cargar la próxima.";

      /**
       * spec 187·D3 · el estado raro se nombra.
       *
       * El comprobante quedó bien y el pago no salió: es un estado válido —es la
       * cuenta corriente— pero la persona eligió «pagado» y tiene que saber que
       * no quedó pagado, y dónde terminarlo.
       */
      if (result.data?.pago === "pendiente") {
        toast.warning(
          "La compra quedó cargada, pero el pago no se pudo registrar. Quedó en la cuenta corriente: pagala desde la ficha del proveedor.",
          { duration: 10_000 },
        );
      } else if (result.data?.pago === "registrado") {
        toast.success(
          values.payment_method === "cash"
            ? `${conInsumos} El pago salió de la Caja Mayor.`
            : `${conInsumos} Quedó pagada.`,
        );
      } else {
        toast.success(conInsumos);
      }

      // Se queda en la pantalla con el formulario limpio: las compras se cargan
      // de a pila —el atado de remitos del día—, y volver a la lista para
      // apretar «Cargar compra» otra vez es la vuelta que esto vino a sacar.
      sesion.current += 1;
      fotos.limpiar();
      setPieTexto({ neto: "", iva: "", percepciones: "" });
      yaLeidas.current = "";
      tocados.current.clear();
      setAutollenados({});
      setItems([]);
      itemsDeLaLectura.current = [];
      setLeido(null);
      setAprender([]);
      setProveedorLeido({
        estado: "sin_foto",
        candidatos: [],
        nombreLeido: null,
        cuitLeido: null,
      });
      form.reset();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  // ── El divisor ────────────────────────────────────────────────

  const cajaRef = useRef<HTMLDivElement>(null);
  const [pctIzquierda, setPctIzquierda] = useState(52);
  // El estado es para pintar; el ref es para decidir. Entre el `pointerdown` y
  // el re-render entran varios `pointermove`, y con el estado solo el divisor
  // arranca a moverse tarde.
  const arrastrandoRef = useRef(false);
  const [arrastrando, setArrastrando] = useState(false);
  /**
   * Abajo de 860 px el divisor no existe: la pantalla pasa a una columna con la
   * foto arriba, pegada. No es el caso de uso —esto se usa en la compu del
   * salón— pero abrir el link en el celular no puede quedar roto.
   */
  const [dosPaneles, setDosPaneles] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 860px)");
    const sincronizar = () => setDosPaneles(mq.matches);
    sincronizar();
    mq.addEventListener("change", sincronizar);
    return () => mq.removeEventListener("change", sincronizar);
  }, []);

  const moverDivisor = (clientX: number) => {
    const caja = cajaRef.current?.getBoundingClientRect();
    if (!caja || caja.width === 0) return;
    const pct = ((clientX - caja.left) / caja.width) * 100;
    setPctIzquierda(Math.min(72, Math.max(28, pct)));
  };

  // ── Irse de acá con la compra a medio cargar ──────────────────
  //
  // Diez minutos revisando un ticket de cuatro fotos se perdían con un click de
  // más: las fotos quedaban huérfanas en el bucket y los renglones revisados no
  // volvían. `beforeunload` cubre la pestaña y el back del navegador; los dos
  // links de salida preguntan aparte, porque una navegación de Next no dispara
  // `beforeunload`.
  const hayAlgo =
    fotos.paginas.length > 0 || items.length > 0 || leido !== null || tocados.current.size > 0;

  useEffect(() => {
    if (!hayAlgo) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [hayAlgo]);

  /** Salir a la lista, borrando del bucket lo que se subió y no se guardó. */
  const salir = () => {
    if (hayAlgo && !window.confirm("Tenés una compra a medio cargar. Si salís se pierde.")) return;
    void fotos.descartar();
    router.push(`/${slug}/admin/proveedores`);
  };

  // ── Qué frena el guardado ─────────────────────────────────────

  const subiendo = fotos.paginas.some((p) => p.estado === "subiendo");
  const motivoBloqueo = !proveedorId
    ? proveedorLeido.estado === "propuesto"
      ? "Confirmá el proveedor"
      : "Elegí el proveedor"
    : subiendo
      ? "Esperá a que suban las fotos"
      : null;

  const conceptosItems = useMemo(
    () =>
      conceptos.map((c) => ({
        id: c.id,
        name: c.name,
        hint: RUBRO_LABELS[c.rubro as ExpenseRubro] ?? c.rubro,
      })),
    [conceptos],
  );

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        // El Enter NO guarda. En un formulario largo el Enter es «pasá al campo
        // siguiente», y acá el submit mueve la cuenta corriente del proveedor:
        // parado en Importe (que arranca con el foco), un Enter guardaba la
        // compra sin renglones, sin número y con la lectura todavía corriendo.
        // Guardar queda sólo en el botón del pie, que es el único lugar donde
        // la persona está mirando lo que va a pasar.
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const el = e.target as HTMLElement;
          if (el.tagName === "TEXTAREA") return;
          e.preventDefault();
        }}
        className={cn(
          "flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden bg-zinc-100/60 md:h-dvh",
          arrastrando && "select-none",
        )}
      >
        {/* `pr-16`: la campana de notificaciones del panel es `fixed` arriba a la
            derecha con z-50 y se come lo que quede debajo — ya se llevó puesta
            la X de «Cargar pedido» una vez. */}
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white py-2.5 pl-4 pr-16">
          <button
            type="button"
            onClick={salir}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            <ArrowLeft className="size-3.5" />
            Proveedores
          </button>
          <h1 className="text-sm font-bold text-zinc-900">Cargar compra</h1>
          {leyendo && (
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
              <Loader2 className="size-3.5 animate-spin" />
              Leyendo {fotos.paths.length === 1 ? "la foto" : `${fotos.paths.length} páginas`}…
            </span>
          )}
          <div className="flex-1" />
          {fotos.paths.length > 0 && !leyendo && (
            <button
              type="button"
              onClick={() => {
                yaLeidas.current = "";
                void leerRef.current();
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
            >
              <RotateCw className="size-3.5" />
              Leer de nuevo
            </button>
          )}
        </header>

        <div
          ref={cajaRef}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto min-[860px]:flex-row min-[860px]:overflow-hidden"
        >
          {/* La foto, grande y quieta. En una columna queda pegada arriba: si se
              va con el scroll, corregir el renglón 9 vuelve a ser corregirlo de
              memoria, que es justo lo que pasaba en el diálogo. */}
          <section
            className="sticky top-0 z-10 shrink-0 bg-zinc-100/95 p-3 backdrop-blur min-[860px]:static min-[860px]:h-full min-[860px]:min-h-0 min-[860px]:shrink min-[860px]:pr-1.5 min-[860px]:backdrop-blur-none"
            style={dosPaneles ? { width: `${pctIzquierda}%` } : undefined}
          >
            <div className="h-[40vh] min-h-0 min-[860px]:h-full">
              <InvoicePhotosUploader fotos={fotos} />
            </div>
          </section>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Ancho de la foto"
            aria-valuenow={Math.round(pctIzquierda)}
            aria-valuemin={28}
            aria-valuemax={72}
            tabIndex={0}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              arrastrandoRef.current = true;
              setArrastrando(true);
            }}
            onPointerMove={(e) => {
              if (!arrastrandoRef.current) return;
              moverDivisor(e.clientX);
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              arrastrandoRef.current = false;
              setArrastrando(false);
            }}
            onPointerCancel={() => {
              arrastrandoRef.current = false;
              setArrastrando(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                setPctIzquierda((v) => Math.max(28, v - 3));
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                setPctIzquierda((v) => Math.min(72, v + 3));
              }
            }}
            className="group hidden w-2 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none min-[860px]:flex"
          >
            <span
              className={cn(
                "h-10 w-1 rounded-full bg-zinc-300 transition group-hover:bg-zinc-500 group-focus-visible:bg-zinc-900",
                arrastrando && "bg-zinc-900",
              )}
            />
          </div>

          <section className="@container min-w-0 flex-1 space-y-3 p-3 min-[860px]:h-full min-[860px]:overflow-y-auto min-[860px]:pl-1.5">
            <BandaProveedor
              estado={proveedorLeido.estado}
              candidatos={proveedorLeido.candidatos}
              nombreLeido={proveedorLeido.nombreLeido}
              cuitLeido={proveedorLeido.cuitLeido}
              suppliers={todosLosProveedores}
              value={proveedorId || null}
              onChange={elegirProveedor}
              onCrear={(nombre, cuit) => void crearProveedor(nombre, cuit)}
              fijado={Boolean(fijado)}
            />

            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3">
              {/* El importe primero, y grande: es el dato que siempre está. */}
              <FormField
                control={form.control}
                name="total_cents"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-2">
                      <FormLabel>Importe ($) *</FormLabel>
                      {autollenados.total_cents && <Autollenado origen={autollenados.total_cents} />}
                    </div>
                    <FormControl>
                      {/* Texto y no `type="number"`, y `parseNumeroAR` y no
                          `parseFloat`. Es el único campo de plata de la pantalla
                          y era el único que no entendía cómo se escribe la plata
                          acá: con `step={1}` una factura de $12.345,67 quedaba
                          en stepMismatch y el submit no hacía NADA salvo un
                          globito del browser sobre un campo que llenó la
                          máquina; y tipeando «12.345,67» el input inválido
                          devolvía "" y `parseFloat("") || 0` mandaba el importe
                          a CERO en silencio. */}
                      <Input
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        placeholder="45.000,00"
                        className="h-12 text-xl font-semibold tabular-nums"
                        value={importeTexto}
                        onChange={(e) => {
                          marcarTocado("total_cents");
                          setImporteTexto(e.target.value);
                          const pesos = parseNumeroAR(e.target.value);
                          field.onChange(pesos === null ? 0 : Math.round(pesos * 100));
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                    {tipo === "nota_credito" && (
                      <p className="text-xs text-amber-700">
                        La nota de crédito va en negativo: resta del saldo.
                      </p>
                    )}
                  </FormItem>
                )}
              />

              <div className="grid gap-3 @md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="expense_concept_id"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        <FormLabel>Concepto</FormLabel>
                        {autollenados.expense_concept_id && (
                          <Autollenado origen={autollenados.expense_concept_id} />
                        )}
                      </div>
                      <FormControl>
                        {/* Buscable como el proveedor: «lo mismo con el
                            concepto». Con 30 conceptos el desplegable nativo
                            obliga a leerlos todos. */}
                        <SelectorBuscable
                          items={conceptosItems}
                          value={(field.value as string | null) ?? null}
                          onChange={(id) => {
                            marcarTocado("expense_concept_id");
                            field.onChange(id);
                          }}
                          placeholder="Buscá el concepto…"
                          vacio="Sin concepto"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="invoice_date"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        <FormLabel>Fecha *</FormLabel>
                        {autollenados.invoice_date && (
                          <Autollenado origen={autollenados.invoice_date} />
                        )}
                      </div>
                      <FormControl>
                        <Input
                          type="date"
                          className="h-10"
                          {...field}
                          onChange={(e) => {
                            marcarTocado("invoice_date");
                            field.onChange(e.target.value);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid gap-3 @md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="document_type"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        <FormLabel>Comprobante</FormLabel>
                        {autollenados.document_type && (
                          <Autollenado origen={autollenados.document_type} />
                        )}
                      </div>
                      <FormControl>
                        <select
                          className="h-10 w-full rounded-lg border border-zinc-200 bg-white px-2 text-sm"
                          value={(field.value as string) ?? "interno"}
                          onChange={(e) => {
                            const nuevo = e.target.value as TipoComprobante;
                            marcarTocado("document_type");
                            field.onChange(nuevo);
                            // El signo lo manda el tipo (schema · D4). Sin esto
                            // el error aparece recién al apretar Guardar, con la
                            // pantalla llena y el foco en otro lado.
                            const actual = Number(form.getValues("total_cents")) || 0;
                            if (nuevo === "nota_credito" && actual > 0) {
                              form.setValue("total_cents", -actual, { shouldValidate: true });
                            } else if (nuevo !== "nota_credito" && actual < 0) {
                              form.setValue("total_cents", -actual, { shouldValidate: true });
                            }
                            // spec 187·D6 · la nota de crédito no se paga. Sin
                            // esto el control desaparece con «Ya la pagué»
                            // adentro y el Zod frena el submit por un campo que
                            // ya no se ve.
                            if (nuevo === "nota_credito") {
                              form.setValue("payment_condition", "cuenta_corriente", {
                                shouldValidate: true,
                              });
                            }
                          }}
                        >
                          {DOCUMENT_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {etiquetaTipo(t)}
                            </option>
                          ))}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="due_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vence</FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          className="h-10"
                          {...field}
                          value={(field.value as string | null) ?? ""}
                          onChange={(e) => {
                            marcarTocado("due_date");
                            field.onChange(e.target.value || null);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                      {!tocados.current.has("due_date") && plazo > 0 && (
                        <p className="text-xs text-zinc-500">
                          A {plazo} días, como el proveedor.
                        </p>
                      )}
                    </FormItem>
                  )}
                />
              </div>

              {/* ── El desglose fiscal — spec 188 ────────────────────────
                  «¿El sistema discrimina los artículos y le pone IVA?» (Rocío,
                  2026-09-15). Sólo en la factura A: es el único comprobante que
                  discrimina, y pedirle el neto a un ticket sería pedir que se
                  invente un crédito fiscal que no existe (D2). */}
              {discrimina && (
                <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50/60 p-2.5">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-zinc-700">Desglose fiscal</p>
                    {autollenados.neto_cents && <Autollenado origen={autollenados.neto_cents} />}
                  </div>
                  <div className="grid gap-2 @md:grid-cols-3">
                    {(
                      [
                        ["neto", "Neto gravado"],
                        ["iva", "IVA"],
                        ["percepciones", "Percepciones"],
                      ] as const
                    ).map(([campo, etiqueta]) => (
                      <div key={campo} className="space-y-1">
                        <label
                          htmlFor={`pie-${campo}`}
                          className="text-[11px] font-medium text-zinc-500"
                        >
                          {etiqueta}
                        </label>
                        <Input
                          id={`pie-${campo}`}
                          type="text"
                          inputMode="decimal"
                          placeholder="—"
                          className="h-9 text-sm tabular-nums"
                          value={pieTexto[campo]}
                          onChange={(e) => escribirPie(campo, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                  {/* D4 · se muestra y NO frena: un pie que no cierra por
                      impuestos internos o un redondeo del proveedor no puede
                      impedir cargar la compra. Misma política que la 165·D2 con
                      Σ renglones ≠ total. */}
                  {pie.estado === "no_cuadra" ? (
                    <p className="text-[11px] text-amber-700">
                      Neto + IVA + percepciones da{" "}
                      {formatCurrency(totalCents - pie.diferenciaCents)} y el total dice{" "}
                      {formatCurrency(totalCents)}: hay{" "}
                      {formatCurrency(Math.abs(pie.diferenciaCents))} de diferencia. Se
                      carga igual — mirá si falta una percepción.
                    </p>
                  ) : pie.estado === "cuadra" ? (
                    <p className="text-[11px] text-zinc-500">
                      Cierra contra el total. El IVA es crédito fiscal: al costo de los
                      insumos va el neto.
                    </p>
                  ) : (
                    <p className="text-[11px] text-zinc-400">
                      Lo que no esté en el papel dejalo vacío. Vacío no es cero.
                    </p>
                  )}
                </div>
              )}

              {/* ── La condición de pago — spec 187 ──────────────────────
                  «En la misma carga debería estar la opción de pago: efectivo o
                  cta cte» (Rocío, 2026-09-15). Va acá abajo, después del
                  vencimiento, porque es la misma pregunta: cuándo se paga esto.
                  En la nota de crédito no aparece: no se paga, resta (D6). */}
              {tipo !== "nota_credito" && (
                <FormField
                  control={form.control}
                  name="payment_condition"
                  render={({ field }) => {
                    const contado = field.value === "contado";
                    return (
                      <FormItem>
                        <div className="flex items-center gap-2">
                          <FormLabel>Cómo se paga</FormLabel>
                          {autollenados.payment_condition && (
                            <Autollenado origen={autollenados.payment_condition} />
                          )}
                        </div>
                        <FormControl>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
                              {(
                                [
                                  ["cuenta_corriente", "Cuenta corriente"],
                                  ["contado", "Ya la pagué"],
                                ] as const
                              ).map(([valor, texto]) => (
                                <button
                                  key={valor}
                                  type="button"
                                  onClick={() => {
                                    marcarTocado("payment_condition");
                                    field.onChange(valor);
                                  }}
                                  className={cn(
                                    "rounded-md px-3 py-1.5 text-xs font-medium transition",
                                    field.value === valor
                                      ? "bg-white text-zinc-900 shadow-sm"
                                      : "text-zinc-500 hover:text-zinc-900",
                                  )}
                                >
                                  {texto}
                                </button>
                              ))}
                            </div>

                            {contado && (
                              <select
                                className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm"
                                value={(form.watch("payment_method") as string) ?? "cash"}
                                onChange={(e) => {
                                  marcarTocado("payment_method");
                                  form.setValue(
                                    "payment_method",
                                    e.target.value as (typeof SUPPLIER_PAYMENT_METHODS)[number],
                                    { shouldDirty: true },
                                  );
                                }}
                                aria-label="Medio de pago"
                              >
                                {SUPPLIER_PAYMENT_METHODS.map((m) => (
                                  <option key={m} value={m}>
                                    {METODOS[m]}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </FormControl>
                        <FormMessage />
                        {/* De dónde sale la plata, dicho antes de apretar y no
                            después: el egreso va a la Caja Mayor y no al cajón
                            del turno, así que no descuadra ningún arqueo (160). */}
                        <p className="text-xs text-zinc-500">
                          {!contado
                            ? "Queda como deuda en la cuenta corriente del proveedor."
                            : form.watch("payment_method") === "cash"
                              ? "Sale de la Caja Mayor y queda como sangría en el libro."
                              : "Se registra el pago, sin movimiento de caja."}
                        </p>
                      </FormItem>
                    );
                  }}
                />
              )}

              {/* El número sólo cuando hay comprobante que numerar. */}
              {conNumero && (
                <FormField
                  control={form.control}
                  name="invoice_number"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center gap-2">
                        <FormLabel>Número</FormLabel>
                        {autollenados.invoice_number && (
                          <Autollenado origen={autollenados.invoice_number} />
                        )}
                      </div>
                      <FormControl>
                        <Input
                          placeholder="0001-00012345"
                          className="h-10"
                          {...field}
                          value={(field.value as string | null) ?? ""}
                          onChange={(e) => {
                            marcarTocado("invoice_number");
                            field.onChange(e.target.value);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Observaciones…"
                        rows={2}
                        {...field}
                        value={(field.value as string | null) ?? ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* El número leído del comprobante se guardaba en un campo OCULTO
                cuando el tipo quedaba en «interno»: acá se avisa, porque el
                número es lo que después identifica la factura ante el proveedor. */}
            {!conNumero && form.watch("invoice_number") ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                Leí el número {String(form.watch("invoice_number"))} pero el comprobante está
                como «Sin comprobante», así que no se guarda. Elegí el tipo de arriba si es
                una factura.
              </p>
            ) : null}

            {leyendo && (
              <p className="rounded-lg border border-dashed border-zinc-200 py-3 text-center text-xs text-zinc-500">
                Leyendo el comprobante… puede tardar hasta medio minuto. Las fotos ya
                quedaron guardadas y podés ir completando a mano.
              </p>
            )}

            {leido && (
              <RevisionLectura
                key={lecturaId}
                renglones={leido}
                insumos={insumos}
                totalComprobanteCents={totalCents}
                baseDelPrecio={baseDelComprobante(tipo)}
                tasaComprobante={tasaComprobante}
                onIrAPagina={irAPagina}
                onConfirmar={(nuevos, confirmados) => {
                  // Los renglones que la persona cargó A MANO se conservan: el
                  // lector es un acelerador, no puede borrar trabajo. Antes
                  // `setItems(nuevos)` los pisaba sin avisar — y como el editor
                  // manual estaba oculto mientras se leía, ni siquiera se veía
                  // desaparecer.
                  const aMano = items.filter((i) => !itemsDeLaLectura.current.includes(i));
                  itemsDeLaLectura.current = nuevos;
                  setItems([...aMano, ...nuevos]);
                  setAprender(confirmados);
                  setLeido(null);
                }}
                onDescartar={() => {
                  // Descartar la lectura descarta LA LECTURA, no lo que había.
                  const aMano = items.filter((i) => !itemsDeLaLectura.current.includes(i));
                  itemsDeLaLectura.current = [];
                  setItems(aMano);
                  setLeido(null);
                }}
              />
            )}

            {/* Sigue en pantalla mientras se lee: son 15-40 segundos, y
                desmontarlo dejaba a la persona sin dónde seguir cargando (y le
                robaba el foco). La lectura no toca `items`. */}
            {!leido && insumos.length > 0 && (
              <RenglonesEditor
                insumos={insumos}
                value={items}
                onChange={setItems}
                totalComprobanteCents={totalCents}
              />
            )}
          </section>
        </div>

        {/* La barra de acción, fija abajo y a lo ancho: en una pantalla de la
            altura del viewport, un botón al final del scroll es un botón que
            hay que ir a buscar. */}
        <footer className="flex shrink-0 items-center gap-3 border-t border-zinc-200 bg-white px-4 py-2.5">
          <div className="min-w-0 flex-1 text-xs text-zinc-500">
            <span className="font-semibold tabular-nums text-zinc-900">
              {formatCurrency(totalCents)}
            </span>
            {proveedorSel ? ` · ${proveedorSel.name}` : ""}
            {items.length > 0
              ? ` · ${items.length} ${items.length === 1 ? "insumo" : "insumos"}`
              : ""}
            {fotos.paginas.length > 0
              ? ` · ${fotos.paginas.length} ${fotos.paginas.length === 1 ? "foto" : "fotos"}`
              : ""}
          </div>
          {/* El motivo al lado del botón apagado: un botón gris sin explicación
              se lee como «no anda» y termina en un llamado por teléfono. */}
          {motivoBloqueo && (
            <span className="shrink-0 text-xs font-medium text-amber-700">{motivoBloqueo}</span>
          )}
          <button
            type="button"
            onClick={salir}
            className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            Cancelar
          </button>
          <Button type="submit" size="lg" disabled={submitting || Boolean(motivoBloqueo)}>
            {submitting ? "Guardando…" : "Cargar compra"}
          </Button>
        </footer>
      </form>
    </Form>
  );
}
