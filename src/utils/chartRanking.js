export function latestFiniteValue(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(values[index])) return values[index];
  }
  return Number.NEGATIVE_INFINITY;
}

export function chartLatestStrength(chart) {
  return latestFiniteValue(chart?.data?.datasets?.[0]?.data);
}

export function rankChartsByLatestStrength(charts) {
  return charts
    .map((chart, index) => ({ chart, index, strength: chartLatestStrength(chart) }))
    .sort((a, b) => b.strength - a.strength || a.index - b.index)
    .map(({ chart }) => chart);
}

export function rankDatasetsByLatestStrength(datasets) {
  return datasets
    .map((dataset, index) => ({ dataset, index, strength: latestFiniteValue(dataset.data) }))
    .sort((a, b) => b.strength - a.strength || a.index - b.index)
    .map(({ dataset }) => dataset);
}
