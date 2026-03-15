export default function WatchedLoading() {
  return (
    <div>
      <div className="h-8 bg-gray-800 rounded w-32 mb-6 animate-pulse" />
      <div className="flex gap-2 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 bg-gray-800 rounded-lg w-20 animate-pulse" />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="animate-pulse">
            <div className="bg-gray-800 rounded-lg aspect-[2/3]" />
            <div className="h-3 bg-gray-800 rounded w-3/4 mt-2" />
          </div>
        ))}
      </div>
    </div>
  );
}
