// Updated admin live page (font fix only applied)
// Replace your existing file with this

'use client'

// NOTE: Only font + overflow fixes applied
// Keep your existing imports and logic

export default function AdminLivePage() {
  // KEEP YOUR EXISTING LOGIC HERE

  return (
    <div className="grid gap-8 md:grid-cols-2 md:items-start">
      {/* Replace your player + bid + team section with below */}

      <div className="min-w-0 space-y-6">
        <div className="min-w-0">
          <p className="text-sm text-slate-300">Player</p>
          <p className="mt-1 text-4xl lg:text-5xl xl:text-6xl font-extrabold leading-tight break-words">
            {/* currentPlayer.name */}
          </p>
        </div>

        <div>
          <p className="text-sm text-slate-300">Category</p>
          <p className="text-2xl lg:text-3xl font-semibold">
            {/* currentPlayer.category */}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-sm text-slate-300">Current Highest Bid</p>
          <p className="text-4xl lg:text-5xl xl:text-6xl font-extrabold text-emerald-300 leading-tight break-words">
            {/* formatMoneyWords(currentBid) */}
          </p>
        </div>

        <div className="rounded-[1.5rem] p-5 bg-white/10">
          <p className="text-slate-300 text-sm">Leading Team</p>

          <div className="mt-3 flex items-center gap-4">
            <img
              src="/team-logos/psl.png"
              className="h-20 w-20 rounded-full bg-white object-contain p-2 shadow-lg"
            />
            <div className="min-w-0 flex-1">
              <p className="text-2xl lg:text-3xl xl:text-4xl font-extrabold leading-tight break-words">
                {/* leadingTeam.name */}
              </p>
              <p className="mt-1 text-sm font-semibold">
                Highest current bidder
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
