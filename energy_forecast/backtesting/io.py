from __future__ import annotations

from pathlib import Path

import pandas as pd


def append_predictions(path: str | Path, predictions: pd.DataFrame) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    frame = predictions.reset_index().rename(columns={"index": "timestamp"})
    frame.to_csv(output, mode="a", index=False, header=not output.exists())
