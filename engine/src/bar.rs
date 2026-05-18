use pyo3::prelude::*;

#[pyclass]
#[derive(Clone, Debug)]
pub struct Bar {
    #[pyo3(get, set)]
    pub ts: i64,
    #[pyo3(get, set)]
    pub open: f64,
    #[pyo3(get, set)]
    pub high: f64,
    #[pyo3(get, set)]
    pub low: f64,
    #[pyo3(get, set)]
    pub close: f64,
    #[pyo3(get, set)]
    pub volume: f64,
}

#[pymethods]
impl Bar {
    #[new]
    pub fn new(ts: i64, open: f64, high: f64, low: f64, close: f64, volume: f64) -> Self {
        Bar { ts, open, high, low, close, volume }
    }

    fn __repr__(&self) -> String {
        format!(
            "Bar(ts={}, open={}, high={}, low={}, close={}, volume={})",
            self.ts, self.open, self.high, self.low, self.close, self.volume
        )
    }
}
