import clsx from "clsx";

interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}

export default function Card({
  title,
  children,
  className,
  actions,
}: CardProps) {
  return (
    <div
      className={clsx(
        "bg-white rounded-xl shadow-sm border border-gray-100",
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          {title && (
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  );
}
