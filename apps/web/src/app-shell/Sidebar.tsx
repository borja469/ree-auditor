import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { SidebarMenuItem } from "./AppShellTypes";

export function SidebarSection({
  active,
  disabled = false,
  open,
  title,
  items,
  onToggle,
  openItems,
  onToggleItem
}: {
  active: boolean;
  disabled?: boolean;
  open: boolean;
  title: string;
  items: SidebarMenuItem[];
  onToggle: () => void;
  openItems: Record<string, boolean>;
  onToggleItem: (key: string) => void;
}) {
  const contentId = `sidebar-section-${title.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}`;

  return (
    <section className={`sidebar-section ${active ? "active" : ""} ${open ? "open" : ""}`}>
      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="sidebar-section-toggle"
        disabled={disabled}
        onClick={onToggle}
        type="button"
      >
        <span>{title}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="sidebar-items" id={contentId}>
          <SidebarItems disabled={disabled} items={items} level={1} onToggleItem={onToggleItem} openItems={openItems} />
        </div>
      )}
    </section>
  );
}

function SidebarItems({
  disabled,
  items,
  level,
  onToggleItem,
  openItems
}: {
  disabled: boolean;
  items: SidebarMenuItem[];
  level: number;
  onToggleItem: (key: string) => void;
  openItems: Record<string, boolean>;
}) {
  return (
    <div className={`sidebar-items-list ${level > 1 ? "nested" : ""}`}>
      {items.map((item) => (
        <SidebarMenuEntry disabled={disabled} item={item} key={item.key} level={level} onToggleItem={onToggleItem} openItems={openItems} />
      ))}
    </div>
  );
}

function SidebarMenuEntry({
  disabled,
  item,
  level,
  onToggleItem,
  openItems
}: {
  disabled: boolean;
  item: SidebarMenuItem;
  level: number;
  onToggleItem: (key: string) => void;
  openItems: Record<string, boolean>;
}) {
  const hasChildren = Boolean(item.children?.length);
  const open = openItems[item.key] ?? false;
  const contentId = `sidebar-submenu-${item.key}`;

  if (hasChildren) {
    return (
      <div className={`sidebar-submenu ${item.active ? "active" : ""} ${open ? "open" : ""}`}>
        <button
          aria-controls={contentId}
          aria-expanded={open}
          className={`sidebar-item sidebar-submenu-toggle level-${level} ${item.active ? "active" : ""}`}
          disabled={disabled}
          onClick={() => onToggleItem(item.key)}
          type="button"
        >
          <SidebarItemText item={item} />
          <ChevronDown size={15} />
        </button>
        {open && (
          <div id={contentId}>
            <SidebarItems disabled={disabled} items={item.children ?? []} level={level + 1} onToggleItem={onToggleItem} openItems={openItems} />
          </div>
        )}
      </div>
    );
  }

  return (
    <button className={`sidebar-item level-${level} ${item.active ? "active" : ""}`} disabled={disabled} onClick={item.onSelect} type="button">
      <SidebarItemText item={item} />
    </button>
  );
}

function SidebarItemText({ item }: { item: SidebarMenuItem }) {
  return (
    <span className="sidebar-item-text">
      <strong>{item.label}</strong>
      {item.description && <span className="sidebar-item-description">{item.description}</span>}
    </span>
  );
}
