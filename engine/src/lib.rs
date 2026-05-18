mod bar;
mod portfolio;
mod analytics;
mod indicators;
mod engine;

use std::collections::HashMap;
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use rayon::prelude::*;

pub use bar::Bar;

#[pyfunction]
#[pyo3(signature = (bars, strategy, params, initial_cash=10000.0, taker_fee=0.001, slippage=0.0005, ann_factor=365.0))]
fn run_backtest(
    py: Python<'_>,
    bars: Vec<Bar>,
    strategy: String,
    params: &Bound<'_, PyDict>,
    initial_cash: f64,
    taker_fee: f64,
    slippage: f64,
    ann_factor: f64,
) -> PyResult<PyObject> {
    let params_map = pydict_to_f64_map(params)?;
    engine::run(py, &bars, &strategy, &params_map, initial_cash, taker_fee, slippage, ann_factor)
}

#[pyfunction]
#[pyo3(signature = (bars, strategy, param_grid, n_folds=5, initial_cash=10000.0, taker_fee=0.001, slippage=0.0005))]
fn walk_forward(
    py: Python<'_>,
    bars: Vec<Bar>,
    strategy: String,
    param_grid: Vec<HashMap<String, f64>>,
    n_folds: usize,
    initial_cash: f64,
    taker_fee: f64,
    slippage: f64,
) -> PyResult<PyObject> {
    let n = bars.len();
    if n < n_folds * 2 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "Not enough bars for walk-forward with given number of folds",
        ));
    }

    let fold_size = n / n_folds;

    // Pre-clone fold bar slices so they are owned and Send
    let fold_slices: Vec<(usize, Vec<Bar>)> = (0..n_folds)
        .map(|f| {
            let test_start = f * fold_size;
            let test_end = if f == n_folds - 1 { n } else { (f + 1) * fold_size };
            let fold_bars: Vec<Bar> = bars[test_start..test_end].to_vec();
            (f, fold_bars)
        })
        .collect();

    // Build all (fold_idx, params) work items
    let work_items: Vec<(usize, Vec<Bar>, HashMap<String, f64>)> = fold_slices
        .iter()
        .flat_map(|(fold_idx, fold_bars)| {
            param_grid.iter().map(move |p| (*fold_idx, fold_bars.clone(), p.clone()))
        })
        .collect();

    struct FoldResult {
        fold: usize,
        params: HashMap<String, f64>,
        sharpe: f64,
        total_return: f64,
        max_drawdown: f64,
    }

    // Release GIL while running parallel folds
    let results: Vec<FoldResult> = py.allow_threads(|| {
        work_items
            .into_par_iter()
            .map(|(fold_idx, fold_bars, p)| {
                let (sharpe, total_return, max_drawdown) = Python::with_gil(|py_inner| {
                    engine::run(
                        py_inner,
                        &fold_bars,
                        &strategy,
                        &p,
                        initial_cash,
                        taker_fee,
                        slippage,
                        365.0,
                    )
                    .ok()
                    .and_then(|obj| {
                        let bound = obj.bind(py_inner);
                        let dict = bound.downcast::<PyDict>().ok()?;
                        let sharpe: f64 = dict.get_item("sharpe").ok()??.extract().ok()?;
                        let total_return: f64 =
                            dict.get_item("total_return").ok()??.extract().ok()?;
                        let max_drawdown: f64 =
                            dict.get_item("max_drawdown").ok()??.extract().ok()?;
                        Some((sharpe, total_return, max_drawdown))
                    })
                    .unwrap_or((0.0, 0.0, 0.0))
                });

                FoldResult {
                    fold: fold_idx,
                    params: p,
                    sharpe,
                    total_return,
                    max_drawdown,
                }
            })
            .collect()
    });

    // Aggregate: for each params combo, sum sharpe across folds
    let mut param_scores: HashMap<String, (f64, f64, f64, usize)> = HashMap::new();
    for r in &results {
        let key = format!("{:?}", r.params);
        let entry = param_scores.entry(key).or_insert((0.0, 0.0, 0.0, 0));
        entry.0 += r.sharpe;
        entry.1 += r.total_return;
        entry.2 += r.max_drawdown;
        entry.3 += 1;
    }

    // Find best params by average sharpe
    let best_key = param_scores
        .iter()
        .max_by(|a, b| a.1 .0.partial_cmp(&b.1 .0).unwrap_or(std::cmp::Ordering::Equal))
        .map(|(k, _)| k.clone());

    let out = PyDict::new_bound(py);

    // Per-fold results list
    let fold_list = PyList::empty_bound(py);
    for r in &results {
        let d = PyDict::new_bound(py);
        d.set_item("fold", r.fold)?;
        d.set_item("sharpe", r.sharpe)?;
        d.set_item("total_return", r.total_return)?;
        d.set_item("max_drawdown", r.max_drawdown)?;
        let p_dict = PyDict::new_bound(py);
        for (k, v) in &r.params {
            p_dict.set_item(k, v)?;
        }
        d.set_item("params", p_dict)?;
        fold_list.append(d)?;
    }
    out.set_item("folds", fold_list)?;

    // Summary by param set
    let summary_list = PyList::empty_bound(py);
    for (key, (sum_sharpe, sum_ret, sum_dd, cnt)) in &param_scores {
        let d = PyDict::new_bound(py);
        let avg_sharpe = sum_sharpe / *cnt as f64;
        let avg_ret = sum_ret / *cnt as f64;
        let avg_dd = sum_dd / *cnt as f64;
        d.set_item("avg_sharpe", avg_sharpe)?;
        d.set_item("avg_total_return", avg_ret)?;
        d.set_item("avg_max_drawdown", avg_dd)?;
        d.set_item("is_best", Some(key) == best_key.as_ref())?;
        summary_list.append(d)?;
    }
    out.set_item("summary", summary_list)?;
    out.set_item("n_folds", n_folds)?;
    out.set_item("strategy", strategy)?;

    Ok(out.into())
}

fn pydict_to_f64_map(d: &Bound<'_, PyDict>) -> PyResult<HashMap<String, f64>> {
    let mut map = HashMap::new();
    for (k, v) in d.iter() {
        let key: String = k.extract()?;
        let val: f64 = v.extract().unwrap_or_else(|_| {
            // Try extracting as int first
            v.extract::<i64>().map(|i| i as f64).unwrap_or(0.0)
        });
        map.insert(key, val);
    }
    Ok(map)
}

#[pymodule]
fn caloogy_engine(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<Bar>()?;
    m.add_function(wrap_pyfunction!(run_backtest, m)?)?;
    m.add_function(wrap_pyfunction!(walk_forward, m)?)?;
    Ok(())
}
