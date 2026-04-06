export function formatMoneyWords(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'

  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)} million`
  }

  return value.toLocaleString()
}