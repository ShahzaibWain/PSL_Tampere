type PlayerMetaBadgesProps = {
  country?: string | null
  availability?: string | null
  firstTimePsl?: boolean | null
}

export default function PlayerMetaBadges({
  country,
  availability,
  firstTimePsl,
}: PlayerMetaBadgesProps) {
  const value = availability?.trim() || 'Available All Days'
  const isAllDays = value.toLowerCase() === 'available all days'

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {country ? (
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
          {country}
        </span>
      ) : null}

      <span
        className={`rounded-full px-3 py-1 text-sm font-medium ${
          isAllDays
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-amber-100 text-amber-700'
        }`}
      >
        {value}
      </span>

      {typeof firstTimePsl === 'boolean' ? (
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            firstTimePsl
              ? 'bg-violet-100 text-violet-700'
              : 'bg-slate-200 text-slate-700'
          }`}
        >
          PSL First Time: {firstTimePsl ? 'Yes' : 'No'}
        </span>
      ) : null}
    </div>
  )
}
