"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteProduct } from "@/lib/catalog/product-actions";

export function ProductDeleteButton({
  slug,
  productId,
  productName,
  onDeleted,
  compact = false,
}: {
  slug: string;
  productId: string;
  productName: string;
  /**
   * En el modal del catálogo no hay a dónde navegar: cierra el modal y deja que
   * la lista se refresque. Sin esto, borrar desde el modal empujaba un
   * `router.push` a la página en la que ya estabas.
   */
  onDeleted?: () => void;
  /** Sólo el botón, sin el bloque explicativo (para el footer del modal). */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = () => {
    startTransition(async () => {
      const r = await deleteProduct(slug, productId);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        r.data.soft_deleted
          ? "Archivado. El producto tenía pedidos, se desactivó."
          : "Eliminado.",
      );
      setConfirmDelete(false);
      if (onDeleted) {
        onDeleted();
        router.refresh();
      } else {
        router.push(`/${slug}/admin/catalogo`);
      }
    });
  };

  const boton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="shrink-0 text-rose-700 hover:bg-rose-50 hover:text-rose-700"
      onClick={() => setConfirmDelete(true)}
      disabled={pending}
    >
      <Trash2 className="size-3.5" />
      Eliminar
    </Button>
  );

  return (
    <>
      {compact ? (
        boton
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-foreground text-sm font-semibold">
              Eliminar producto
            </p>
            <p className="text-muted-foreground text-xs">
              Si tiene pedidos asociados se archiva; si no, se borra
              definitivamente.
            </p>
          </div>
          {boton}
        </div>
      )}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar &quot;{productName}&quot;</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Si tiene pedidos asociados se archiva (no aparece en el menú pero el
            historial lo conserva). Si no, se elimina definitivamente.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={pending}
            >
              {pending ? "Eliminando…" : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
