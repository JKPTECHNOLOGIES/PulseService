import clsx from "clsx";

interface SpinnerProps {
  className?: string;
}

export default function Spinner({ className }: SpinnerProps) {
  return (
    <svg
      className={clsx("animate-spin", className ?? "h-5 w-5 text-primary-600")}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export function PageSpinner() {
  return (
    <div className="flex h-full items-center justify-center py-20">
      <Spinner className="h-8 w-8 text-primary-600" />
    </div>
  );
}
