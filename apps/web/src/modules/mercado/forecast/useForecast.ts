import { useCallback, useEffect, useState } from "react";
import {
  activateForecastModel,
  compareForecastModels,
  deleteForecastPrediction,
  getForecastModelDetail,
  getForecastModels,
  getForecastPredictionHistory,
  rejectForecastPrediction,
  predictForecastRange,
  trainForecastModel,
  validateForecastPrediction,
  type ForecastCompareResponse,
  type ForecastModelDetail,
  type ForecastModelsResponse,
  type ForecastPredictionRangeResponse,
  type ForecastPredictionRun,
  type ForecastTrainResponse
} from "../../../api";

export function useForecastModels() {
  const [data, setData] = useState<ForecastModelsResponse>();
  const [detail, setDetail] = useState<ForecastModelDetail>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await getForecastModels());
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await getForecastModelDetail(id);
      setDetail(next);
      return next;
    } catch (caught) {
      setError(readError(caught));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, detail, loading, error, refresh, loadDetail, setDetail };
}

export function useTrainForecastModel(onSuccess: (result: ForecastTrainResponse) => void) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ForecastTrainResponse>();

  const train = useCallback(
    async (request: { fechaDesde: string; fechaHasta: string; modelo: string }) => {
      setLoading(true);
      setError(undefined);
      try {
        const next = await trainForecastModel(request);
        setResult(next);
        onSuccess(next);
      } catch (caught) {
        setError(readError(caught));
      } finally {
        setLoading(false);
      }
    },
    [onSuccess]
  );

  return { train, result, loading, error };
}

export function useActivateForecastModel(onSuccess: () => void) {
  const [loadingId, setLoadingId] = useState<string>();
  const [error, setError] = useState<string>();

  const activate = useCallback(
    async (id: string) => {
      if (!window.confirm("Activar este modelo de prevision? Se desactivara cualquier otro modelo activo.")) {
        return;
      }
      setLoadingId(id);
      setError(undefined);
      try {
        await activateForecastModel(id);
        onSuccess();
      } catch (caught) {
        setError(readError(caught));
      } finally {
        setLoadingId(undefined);
      }
    },
    [onSuccess]
  );

  return { activate, loadingId, error };
}

export function useCompareForecastModels() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ForecastCompareResponse>();

  const compare = useCallback(async (ids: string[]) => {
    if (ids.length < 2) {
      setError("Selecciona al menos dos modelos.");
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      setResult(await compareForecastModels(ids));
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  return { compare, result, loading, error };
}

export function usePredictForecastRange(onSuccess: () => void) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ForecastPredictionRangeResponse>();

  const predict = useCallback(
    async (request: { modeloId: string; fechaDesde: string; fechaHasta: string }) => {
      setLoading(true);
      setError(undefined);
      try {
        setResult(await predictForecastRange(request));
        onSuccess();
      } catch (caught) {
        setError(readError(caught));
      } finally {
        setLoading(false);
      }
    },
    [onSuccess]
  );

  return { predict, result, loading, error };
}

export function useForecastPredictionHistory() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ForecastPredictionRun[]>([]);
  const [deletingId, setDeletingId] = useState<string>();
  const [validatingId, setValidatingId] = useState<string>();

  const refresh = useCallback(async (filters: { modeloId?: string; fechaDesde?: string; fechaHasta?: string } = {}) => {
    setLoading(true);
    setError(undefined);
    try {
      setResult(await getForecastPredictionHistory(filters));
    } catch (caught) {
      setError(readError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteRun = useCallback(
    async (id: string, filters: { modeloId?: string; fechaDesde?: string; fechaHasta?: string } = {}) => {
      if (!window.confirm("Eliminar esta prediccion guardada?")) {
        return;
      }
      setDeletingId(id);
      setError(undefined);
      try {
        await deleteForecastPrediction(id);
        await refresh(filters);
      } catch (caught) {
        setError(readError(caught));
      } finally {
        setDeletingId(undefined);
      }
    },
    [refresh]
  );

  const validateRun = useCallback(
    async (id: string, filters: { modeloId?: string; fechaDesde?: string; fechaHasta?: string } = {}) => {
      setValidatingId(id);
      setError(undefined);
      try {
        await validateForecastPrediction(id);
        await refresh(filters);
      } catch (caught) {
        setError(readError(caught));
      } finally {
        setValidatingId(undefined);
      }
    },
    [refresh]
  );

  const rejectRun = useCallback(
    async (id: string, filters: { modeloId?: string; fechaDesde?: string; fechaHasta?: string } = {}) => {
      const comment = window.prompt("Motivo de rechazo de la prevision") ?? "";
      setValidatingId(id);
      setError(undefined);
      try {
        await rejectForecastPrediction(id, comment);
        await refresh(filters);
      } catch (caught) {
        setError(readError(caught));
      } finally {
        setValidatingId(undefined);
      }
    },
    [refresh]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { refresh, result, loading, error, deleteRun, deletingId, validateRun, rejectRun, validatingId };
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo completar la operacion.";
}
