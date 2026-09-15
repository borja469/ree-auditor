import { useEffect, useMemo, useState } from "react";
import { Star, X } from "lucide-react";
import type { SidebarGroupConfig, SidebarMenuItem } from "./AppShellTypes";

export type NavigationFavorite = {
  id: string;
  label: string;
  route: string;
  section?: string;
  icon?: string;
  order: number;
};

export type FavoriteNavigationTarget = NavigationFavorite & {
  active: boolean;
  description?: string;
  onSelect: () => void;
};

const FAVORITES_STORAGE_PREFIX = "ree-auditor-navigation-favorites";
const INLINE_FAVORITES_LIMIT = 3;

export function useNavigationFavorites(user: string, targets: FavoriteNavigationTarget[]) {
  const storageKey = `${FAVORITES_STORAGE_PREFIX}:${encodeURIComponent(user.trim().toLowerCase() || "default")}`;
  const [favorites, setFavorites] = useState<NavigationFavorite[]>(() => loadFavorites(storageKey));

  useEffect(() => {
    setFavorites(loadFavorites(storageKey));
  }, [storageKey]);

  useEffect(() => {
    saveFavorites(storageKey, favorites);
  }, [favorites, storageKey]);

  const hydratedFavorites = useMemo(() => {
    const byRoute = new Map(targets.map((target) => [target.route, target]));
    const byId = new Map(targets.map((target) => [target.id, target]));
    return favorites
      .reduce<FavoriteNavigationTarget[]>((items, favorite, index) => {
        const target = byRoute.get(favorite.route) ?? byId.get(favorite.id);
        if (!target) {
          return items;
        }
        items.push({
          id: target.id,
          label: target.label,
          route: target.route,
          order: Number.isFinite(favorite.order) ? favorite.order : index,
          active: target.active,
          onSelect: target.onSelect,
          ...(target.section ? { section: target.section } : {}),
          ...(target.icon ? { icon: target.icon } : {}),
          ...(target.description ? { description: target.description } : {})
        });
        return items;
      }, [])
      .sort((left, right) => left.order - right.order);
  }, [favorites, targets]);

  function addFavorite(target: FavoriteNavigationTarget) {
    setFavorites((current) => {
      if (current.some((favorite) => favorite.id === target.id || favorite.route === target.route)) {
        return current;
      }
      return [
        ...current,
        {
          id: target.id,
          label: target.label,
          route: target.route,
          order: current.reduce((max, favorite) => Math.max(max, favorite.order), -1) + 1,
          ...(target.section ? { section: target.section } : {}),
          ...(target.icon ? { icon: target.icon } : {})
        }
      ];
    });
  }

  function removeFavorite(idOrRoute: string) {
    setFavorites((current) => current.filter((favorite) => favorite.id !== idOrRoute && favorite.route !== idOrRoute));
  }

  function toggleFavorite(target: FavoriteNavigationTarget) {
    if (hydratedFavorites.some((favorite) => favorite.id === target.id || favorite.route === target.route)) {
      removeFavorite(target.id);
      return;
    }
    addFavorite(target);
  }

  function isFavorite(target?: Pick<NavigationFavorite, "id" | "route">) {
    return Boolean(target && hydratedFavorites.some((favorite) => favorite.id === target.id || favorite.route === target.route));
  }

  return {
    favorites: hydratedFavorites,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    isFavorite
  };
}

export function buildFavoriteTargets(groups: SidebarGroupConfig[]): FavoriteNavigationTarget[] {
  return groups.flatMap((group) => collectFavoriteTargets(group.items, group.title, []));
}

export function findActiveFavoriteTarget(targets: FavoriteNavigationTarget[]) {
  return targets.find((target) => target.active);
}

export function FavoriteToggle({
  disabled,
  isFavorite,
  onToggle,
  target
}: {
  disabled?: boolean;
  isFavorite: boolean;
  onToggle: () => void;
  target?: FavoriteNavigationTarget;
}) {
  const label = isFavorite ? "Quitar de favoritos" : "Añadir a favoritos";
  return (
    <button
      aria-label={label}
      className={`favorite-toggle ${isFavorite ? "active" : ""}`}
      disabled={disabled || !target}
      onClick={onToggle}
      title={label}
      type="button"
    >
      <Star size={17} fill={isFavorite ? "currentColor" : "none"} />
    </button>
  );
}

export function FavoritesMenu({
  favorites,
  onNavigate,
  onRemove
}: {
  favorites: FavoriteNavigationTarget[];
  onNavigate: (favorite: FavoriteNavigationTarget) => void;
  onRemove: (favorite: FavoriteNavigationTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const inlineFavorites = favorites.slice(0, INLINE_FAVORITES_LIMIT);
  const hasFavorites = favorites.length > 0;

  useEffect(() => {
    if (!hasFavorites) {
      setOpen(false);
    }
  }, [hasFavorites]);

  return (
    <div className="favorites-menu">
      {inlineFavorites.map((favorite) => (
        <button
          className={`favorite-inline-link ${favorite.active ? "active" : ""}`}
          key={favorite.id}
          onClick={() => onNavigate(favorite)}
          title={favorite.section ? `${favorite.section} > ${favorite.label}` : favorite.label}
          aria-current={favorite.active ? "page" : undefined}
          type="button"
        >
          {favorite.label}
        </button>
      ))}
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={`favorites-menu-button ${open ? "active" : ""}`}
        disabled={!hasFavorites}
        onClick={() => setOpen((current) => !current)}
        title={hasFavorites ? "Favoritos" : "Sin favoritos"}
        type="button"
      >
        <Star size={16} fill={hasFavorites ? "currentColor" : "none"} />
        <span>Favoritos</span>
        {hasFavorites && <small>{favorites.length}</small>}
      </button>
      {open && hasFavorites && (
        <div className="favorites-dropdown" role="menu">
          <strong>Favoritos</strong>
          {favorites.map((favorite) => (
            <div className={`favorites-dropdown-row ${favorite.active ? "active" : ""}`} key={favorite.id}>
              <button
                aria-current={favorite.active ? "page" : undefined}
                className="favorites-dropdown-link"
                onClick={() => {
                  onNavigate(favorite);
                  setOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <span>{favorite.label}</span>
                {favorite.section && <small>{favorite.section}</small>}
              </button>
              <button
                aria-label={`Quitar ${favorite.label} de favoritos`}
                className="favorites-remove-button"
                onClick={() => {
                  onRemove(favorite);
                  if (favorites.length <= 1) {
                    setOpen(false);
                  }
                }}
                title="Quitar de favoritos"
                type="button"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function collectFavoriteTargets(items: SidebarMenuItem[], groupTitle: string, parents: string[]): FavoriteNavigationTarget[] {
  return items.flatMap((item) => {
    const section = [groupTitle, ...parents].join(" > ");
    if (item.children?.length) {
      return collectFavoriteTargets(item.children, groupTitle, [...parents, item.label]);
    }
    if (!item.onSelect) {
      return [];
    }
    return [{
      id: item.key,
      label: item.label,
      route: `nav:${item.key}`,
      order: 0,
      active: item.active,
      onSelect: item.onSelect,
      ...(section ? { section } : {}),
      ...(item.description ? { description: item.description } : {})
    }];
  });
}

function loadFavorites(storageKey: string): NavigationFavorite[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as Partial<NavigationFavorite>[];
    return parsed
      .filter((favorite) => typeof favorite.id === "string" && typeof favorite.route === "string" && typeof favorite.label === "string")
      .map((favorite, index) => ({
        id: favorite.id as string,
        label: favorite.label as string,
        route: favorite.route as string,
        order: typeof favorite.order === "number" ? favorite.order : index,
        ...(typeof favorite.section === "string" ? { section: favorite.section } : {}),
        ...(typeof favorite.icon === "string" ? { icon: favorite.icon } : {})
      }));
  } catch {
    return [];
  }
}

function saveFavorites(storageKey: string, favorites: NavigationFavorite[]) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(favorites));
}
