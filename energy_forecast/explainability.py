from __future__ import annotations

import pandas as pd


def explain_tree_model(model: object, X: pd.DataFrame, top_n: int = 5) -> dict[str, list[dict[str, float | str]]]:
    try:
        import shap

        explainer = shap.TreeExplainer(model)
        values = explainer.shap_values(X)
        impacts = pd.DataFrame(values, index=X.index, columns=X.columns).mean()
        unit = "EUR/MWh" if values is not None else "relative"
    except Exception:
        importances = getattr(model, "feature_importances_", None)
        if importances is None:
            return {"bullish": [], "bearish": []}
        impacts = pd.Series(importances, index=X.columns)
        unit = "relative"
    bullish = impacts.sort_values(ascending=False).head(top_n)
    bearish = impacts.sort_values(ascending=True).head(top_n)
    return {
        "bullish": [{"feature": key, "impact": float(value), "unit": unit} for key, value in bullish.items()],
        "bearish": [{"feature": key, "impact": float(value), "unit": unit} for key, value in bearish.items()],
    }

