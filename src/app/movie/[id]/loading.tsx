export default function MovieLoading() {
  return (
    <div className="w-full max-w-2xl mx-auto animate-pulse">
      <div className="flex gap-6">
        <div className="w-48 flex-shrink-0 bg-gray-800 rounded-lg aspect-[2/3]" />
        <div className="flex flex-col gap-3 flex-1">
          <div className="h-6 bg-gray-800 rounded w-3/4" />
          <div className="h-3 bg-gray-800 rounded w-1/4" />
          <div className="h-3 bg-gray-800 rounded w-1/3" />
          <div className="h-3 bg-gray-800 rounded w-full mt-4" />
          <div className="h-3 bg-gray-800 rounded w-5/6" />
          <div className="h-3 bg-gray-800 rounded w-4/6" />
        </div>
      </div>
    </div>
  );
}
