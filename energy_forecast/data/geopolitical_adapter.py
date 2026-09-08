from __future__ import annotations

from datetime import datetime

import pandas as pd

from .contracts import MADRID_TZ


class GeopoliticalAdapter:
    def load_hourly(self, start: datetime, end: datetime) -> pd.DataFrame:
        return pd.DataFrame(index=pd.date_range(start=start, end=end, freq="h", tz=MADRID_TZ))

