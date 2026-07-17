import type { CSSProperties, ReactNode } from "react";

type FilterToolbarProps = {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
};

type FilterToolbarGroupProps = {
  children: ReactNode;
  className?: string;
};

type FilterToolbarFieldProps = {
  label: string;
  children: ReactNode;
  className?: string;
  width?: number | string;
};

export function FilterToolbar({ children, className, ariaLabel = "Barra de filtros y acciones" }: FilterToolbarProps) {
  return (
    <section className={`filter-toolbar ${className ?? ""}`.trim()} aria-label={ariaLabel} role="toolbar">
      {children}
    </section>
  );
}

export function FilterToolbarGroup({ children, className }: FilterToolbarGroupProps) {
  return <div className={`filter-toolbar-group ${className ?? ""}`.trim()}>{children}</div>;
}

export function FilterToolbarField({ label, children, className, width }: FilterToolbarFieldProps) {
  const style = (width === undefined ? undefined : { width: typeof width === "number" ? `${width}px` : width }) as CSSProperties | undefined;
  return (
    <label className={`filter-field filter-toolbar-field ${className ?? ""}`.trim()} style={style}>
      <span>{label}</span>
      {children}
    </label>
  );
}
