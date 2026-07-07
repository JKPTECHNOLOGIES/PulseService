import { LightBulbIcon } from "@heroicons/react/24/outline";
import { PageHelpContent } from "../../content/pageHelp";

interface PageHelpBodyProps {
  content: PageHelpContent;
}

/**
 * Renders a page-help guide's content (summary, sections, tips). Shared by
 * the per-page help modal (PageHelpModal) and the full Help Center page, so
 * the two stay visually consistent.
 */
export default function PageHelpBody({ content }: PageHelpBodyProps) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">{content.summary}</p>

      {content.sections.map((section, i) => (
        <div key={section.heading ?? i}>
          {section.heading && (
            <h4 className="text-sm font-semibold text-gray-900 mb-2">
              {section.heading}
            </h4>
          )}
          <ul className="space-y-1.5">
            {section.items.map((item, j) => (
              <li key={j} className="flex gap-2 text-sm text-gray-600">
                <span className="mt-1.5 h-1 w-1 rounded-full bg-gray-300 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {content.tips && content.tips.length > 0 && (
        <div className="rounded-lg bg-primary-50 dark:bg-primary-950/40 border border-primary-100 dark:border-primary-800/60 p-4">
          <div className="flex items-center gap-2 mb-2">
            <LightBulbIcon className="h-4 w-4 text-primary-600 dark:text-primary-400 shrink-0" />
            <h4 className="text-sm font-semibold text-primary-900 dark:text-primary-100">
              Tips
            </h4>
          </div>
          <ul className="space-y-1.5">
            {content.tips.map((tip, i) => (
              <li
                key={i}
                className="text-sm text-primary-800 dark:text-primary-200"
              >
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
