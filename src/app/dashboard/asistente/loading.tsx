export default function Loading() {
  return (
    <div className="-m-3 flex h-[calc(100dvh-3.5rem)] lg:-m-6">
      <aside className="hidden w-64 shrink-0 border-r border-border p-2 lg:block">
        <div className="asst-shimmer h-9 w-full rounded-xl" />
        <div className="mt-3 space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="asst-shimmer h-8 w-full rounded-lg" />
          ))}
        </div>
      </aside>
      <div className="flex flex-1 flex-col">
        <div className="flex h-12 items-center gap-2 border-b border-border px-3">
          <div className="asst-shimmer size-7 rounded-lg" />
          <div className="asst-shimmer h-4 w-28 rounded" />
        </div>
        <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6">
          <div className="flex justify-end">
            <div className="asst-shimmer h-10 w-1/2 rounded-2xl" />
          </div>
          <div className="space-y-2">
            <div className="asst-shimmer h-4 w-3/4 rounded" />
            <div className="asst-shimmer h-4 w-2/3 rounded" />
            <div className="asst-shimmer h-4 w-1/2 rounded" />
          </div>
        </div>
        <div className="border-t border-border p-3">
          <div className="asst-shimmer mx-auto h-12 max-w-3xl rounded-2xl" />
        </div>
      </div>
    </div>
  )
}
