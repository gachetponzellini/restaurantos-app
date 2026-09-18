// El template se vuelve a montar en cada navegación dentro de la parte
// pública (menú → carrito → checkout), así que la clase re-dispara el fundido
// de entrada. Es CSS y no Motion a propósito: lo que viene del server se pinta
// animado sin esperar a que hidrate el JS. Sólo opacidad: un transform en este
// wrapper convertiría en relativos a él todos los `position: fixed` de adentro
// (pill del carrito, sheets).
export default function PublicTemplate({ children }: { children: React.ReactNode }) {
  return <div className="m-page">{children}</div>;
}
