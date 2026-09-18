import { I, ImageTile } from "@/components/delivery/primitives";
import { formatCurrency } from "@/lib/currency";
import type { MenuDailyMenu } from "@/lib/menu";

/**
 * Sección destacada "Hoy — Lunes 21 de abril" que lista los menús del día
 * activos hoy. Si la lista viene vacía, el componente padre no tiene que
 * renderizar este componente — desde aquí devolvemos `null` por defensa.
 */
export function DailyMenuSection({
  menus,
  todayLabel,
  disabled,
  onSelect,
}: {
  menus: MenuDailyMenu[];
  todayLabel: string;
  disabled?: boolean;
  onSelect: (menu: MenuDailyMenu) => void;
}) {
  if (menus.length === 0) return null;

  return (
    <>
      {menus.length > 0 && (
        <section
          style={{
            background: "linear-gradient(180deg, #FFF7E5 0%, #FDF4E1 100%)",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          <header style={{ padding: "14px 16px 6px" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 8px",
                borderRadius: 99,
                background: "rgba(0,0,0,0.06)",
                fontSize: 10.5,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: "var(--ink-2)",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 99,
                  background: "#C5872B",
                }}
              />
              Menú del día
            </div>
            <div
              className="d-display"
              style={{
                marginTop: 6,
                fontSize: 20,
                lineHeight: 1.15,
                color: "var(--ink)",
                textTransform: "capitalize",
              }}
            >
              Hoy — {todayLabel}
            </div>
          </header>

          <div style={{ padding: "4px 16px 14px" }}>
            {menus.map((menu) => (
              <DailyMenuCard
                key={menu.id}
                menu={menu}
                disabled={disabled}
                onSelect={onSelect}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function DailyMenuCard({
  menu,
  disabled,
  onSelect,
}: {
  menu: MenuDailyMenu;
  disabled?: boolean;
  onSelect: (menu: MenuDailyMenu) => void;
}) {
  const preview = menu.components.slice(0, 3);
  const more = menu.components.length - preview.length;
  return (
    <button
      type="button"
      onClick={() => !disabled && onSelect(menu)}
      disabled={disabled}
      style={{
        width: "100%",
        display: "flex",
        gap: 14,
        padding: 12,
        marginTop: 10,
        background: "#fff",
        borderRadius: 14,
        border: "1px solid rgba(197, 135, 43, 0.18)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {menu.image_url && (
        <ImageTile
          src={menu.image_url}
          alt={menu.name}
          tone="#E9C88A"
          sizes="96px"
          style={{ width: 96, height: 96, borderRadius: 10, flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "var(--ink)",
              letterSpacing: -0.15,
            }}
          >
            {menu.name}
          </span>
        </div>
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            fontSize: 12.5,
            color: "var(--ink-2)",
            lineHeight: 1.35,
          }}
        >
          {preview.map((c) => (
            <li
              key={c.id}
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              · {c.label}
            </li>
          ))}
          {more > 0 && (
            <li style={{ color: "var(--ink-3)", fontSize: 11.5 }}>
              +{more} más
            </li>
          )}
        </ul>
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
            {formatCurrency(menu.price_cents)}
          </span>
          {!disabled && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--accent)",
              }}
            >
              Ver menú {I.chevRight("var(--accent)", 12)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
