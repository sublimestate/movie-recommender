export default function LikedLoading() {
  return (
    <div>
      <div className="h-8 bg-gray-800 rounded w-24 mb-6 animate-pulse" />
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
