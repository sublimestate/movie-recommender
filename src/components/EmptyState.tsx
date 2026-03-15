export default function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <p className="text-gray-500 text-lg">{message}</p>
    </div>
  );
}
