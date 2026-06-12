import { type ReactNode, useEffect, useRef, useState } from "react";
import { useGlobalLoadingState } from "./loading";

const SHOW_DELAY_MS = 260;
const MIN_VISIBLE_MS = 180;
const EXIT_MS = 160;

export function LoadingSquares({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`loader loading-squares ${compact ? "loading-squares--compact" : ""}`} aria-hidden="true">
      <div className="loader-square loading-squares__square" />
      <div className="loader-square loading-squares__square" />
      <div className="loader-square loading-squares__square" />
      <div className="loader-square loading-squares__square" />
      <div className="loader-square loading-squares__square" />
      <div className="loader-square loading-squares__square" />
      <div className="loader-square loading-squares__square" />
    </div>
  );
}

export function InlineLoading({ label = "Actualizando" }: { label?: string }) {
  return (
    <div className="inline-loading" role="status" aria-live="polite">
      <LoadingSquares compact />
      <span>{label}</span>
    </div>
  );
}

export function LoadingRegion({
  loading,
  label = "Cargando datos",
  children
}: {
  loading: boolean;
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="loading-region" aria-busy={loading}>
      {children}
      {loading && (
        <div className="loading-region__overlay" role="status" aria-live="polite">
          <LoadingSquares compact />
          <span>{label}</span>
        </div>
      )}
    </div>
  );
}

export function ButtonLoadingContent({
  loading,
  loadingLabel = "Procesando",
  icon,
  children
}: {
  loading: boolean;
  loadingLabel?: string;
  icon: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      {loading ? <LoadingSquares compact /> : icon}
      {children && <span>{loading ? loadingLabel : children}</span>}
    </>
  );
}

export function GlobalLoadingOverlay() {
  const state = useGlobalLoadingState();
  const [rendered, setRendered] = useState(false);
  const [entered, setEntered] = useState(false);
  const visibleSince = useRef(0);

  useEffect(() => {
    if (state.active) {
      if (rendered) {
        setEntered(true);
        return undefined;
      }

      const showTimer = window.setTimeout(() => {
        setRendered(true);
        window.requestAnimationFrame(() => {
          visibleSince.current = performance.now();
          setEntered(true);
        });
      }, SHOW_DELAY_MS);

      return () => window.clearTimeout(showTimer);
    }

    if (!rendered) {
      setEntered(false);
      return undefined;
    }

    const elapsed = visibleSince.current === 0 ? MIN_VISIBLE_MS : performance.now() - visibleSince.current;
    const hideDelay = Math.max(MIN_VISIBLE_MS - elapsed, 0);
    let unmountTimer: number | undefined;
    const hideTimer = window.setTimeout(() => {
      setEntered(false);
      unmountTimer = window.setTimeout(() => {
        setRendered(false);
        visibleSince.current = 0;
      }, EXIT_MS);
    }, hideDelay);

    return () => {
      window.clearTimeout(hideTimer);
      if (unmountTimer !== undefined) {
        window.clearTimeout(unmountTimer);
      }
    };
  }, [rendered, state.active]);

  useEffect(() => {
    document.body.classList.toggle("global-loading-active", rendered && entered && state.blocking);
    return () => document.body.classList.remove("global-loading-active");
  }, [entered, rendered, state.blocking]);

  if (!rendered) {
    return (
      <div className="sr-only" aria-live="polite">
        {state.active ? "Cargando" : "Carga completada"}
      </div>
    );
  }

  return (
    <div
      className={`global-loading-overlay ${entered ? "is-visible" : ""}`}
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <div className="global-loading-card">
        <LoadingSquares />
        <strong>{state.label ?? "Cargando"}</strong>
        <span>Actualizando informacion operativa</span>
      </div>
    </div>
  );
}
