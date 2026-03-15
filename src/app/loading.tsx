export default function Loading() {
  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-2xl flex animate-pulse">
        <div className="w-40 sm:w-48 flex-shrink-0 bg-gray-800 aspect-[2/3]" />
        <div className="p-4 flex flex-col gap-3 flex-1">
          <div className="h-5 bg-gray-800 rounded w-3/4" />
          <div className="h-3 bg-gray-800 rounded w-1/4" />
          <div className="h-3 bg-gray-800 rounded w-1/3" />
          <div className="flex gap-2">
            <div className="h-5 bg-gray-800 rounded-full w-14" />
            <div className="h-5 bg-gray-800 rounded-full w-14" />
          </div>
          <div className="h-3 bg-gray-800 rounded w-full mt-auto" />
          <div className="h-3 bg-gray-800 rounded w-5/6" />
        </div>
      </div>
    </div>
  );
}
