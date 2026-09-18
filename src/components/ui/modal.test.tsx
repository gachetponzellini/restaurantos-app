import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  InlineModal,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "./modal";

/**
 * Spec 204 — la anatomía común. Lo que se fija acá es el contrato del que
 * dependen los modales migrados: el título nombra al diálogo (los tests y el
 * lector de pantalla lo buscan por nombre), el cerrar se llama «Cerrar», y el
 * `InlineModal` sigue siendo un `role="dialog"` que no deja pasar el click.
 */
describe("Modal (spec 204)", () => {
  it("ModalContent: el título nombra al diálogo y la descripción lo describe", () => {
    render(
      <Modal open>
        <ModalContent>
          <ModalHeader title="Registrar sangría" description="Sacar efectivo" />
          <ModalBody>cuerpo</ModalBody>
          <ModalFooter>pie</ModalFooter>
        </ModalContent>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Registrar sangría" });
    expect(dialog).toHaveAccessibleDescription("Sacar efectivo");
  });

  it("ModalContent: «Cerrar» cierra", async () => {
    const onOpenChange = vi.fn();
    render(
      <Modal open onOpenChange={onOpenChange}>
        <ModalContent>
          <ModalHeader title="X" />
        </ModalContent>
      </Modal>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });

  it("InlineModal: es un diálogo con nombre; el fondo cierra y la caja no", async () => {
    const onClose = vi.fn();
    render(
      <InlineModal onClose={onClose} overlay="absolute">
        <ModalHeader title="Trasladar mesa 4" />
        <ModalBody>
          <button type="button">adentro</button>
        </ModalBody>
      </InlineModal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Trasladar mesa 4" });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    await userEvent.click(screen.getByRole("button", { name: "adentro" }));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("InlineModal: respeta un aria-label propio y un titleId fijo", () => {
    const { rerender } = render(
      <InlineModal onClose={() => {}} aria-label="Milanesa">
        <ModalHeader title="Milanesa" />
      </InlineModal>,
    );
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-labelledby");

    rerender(
      <InlineModal onClose={() => {}} titleId="elegir-mozo-titulo">
        <ModalHeader title="Asignar mozo" />
      </InlineModal>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-labelledby",
      "elegir-mozo-titulo",
    );
    expect(document.getElementById("elegir-mozo-titulo")).toHaveTextContent(
      "Asignar mozo",
    );
  });
});
