import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronLeftIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import PageHelpBody from "../components/layout/PageHelpBody";
import {
  pageHelpList,
  getPageHelpMeta,
  PageHelpContent,
} from "../content/pageHelp";
import { usePageHelpSeen } from "../hooks/usePageHelpSeen";

function matchesSearch(content: PageHelpContent, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  if (content.title.toLowerCase().includes(needle)) return true;
  if (content.summary.toLowerCase().includes(needle)) return true;
  for (const section of content.sections) {
    if (section.heading?.toLowerCase().includes(needle)) return true;
    if (section.items.some((item) => item.toLowerCase().includes(needle))) {
      return true;
    }
  }
  if (content.tips?.some((tip) => tip.toLowerCase().includes(needle))) {
    return true;
  }
  return false;
}

/**
 * A searchable library of every per-page guide in the app (the same content
 * shown one-page-at-a-time via the Header's "?" button / first-visit
 * onboarding), so a user can browse or look something up without having to
 * visit each page.
 */
export default function HelpCenterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasSeen } = usePageHelpSeen();

  const requestedTopic = searchParams.get("topic");
  const [activeKey, setActiveKey] = useState<string>(() =>
    requestedTopic && pageHelpList.some((c) => c.key === requestedTopic)
      ? requestedTopic
      : pageHelpList[0].key,
  );
  const [mobileDetailOpen, setMobileDetailOpen] = useState(
    Boolean(requestedTopic),
  );
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () => pageHelpList.filter((c) => matchesSearch(c, search)),
    [search],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, PageHelpContent[]>();
    for (const content of filtered) {
      const { group } = getPageHelpMeta(content.key);
      const items = map.get(group) ?? [];
      items.push(content);
      map.set(group, items);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const activeContent =
    pageHelpList.find((c) => c.key === activeKey) ?? pageHelpList[0];
  const activeMeta = getPageHelpMeta(activeContent.key);
  const ActiveIcon = activeMeta.icon;

  const selectTopic = (key: string) => {
    setActiveKey(key);
    setMobileDetailOpen(true);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Help Center</h2>
        <p className="text-sm text-gray-500">
          Simple, plain-English guides for what each page in Prime Comfort
          Solutions does.
        </p>
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search guides…"
        className="max-w-md"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5 items-start">
        {/* Guide list, grouped like the app's own navigation */}
        <aside
          className={clsx(
            "space-y-5",
            mobileDetailOpen ? "hidden lg:block" : "block",
          )}
        >
          {grouped.map(([group, items]) => (
            <div key={group}>
              <h3 className="px-1 mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {group}
              </h3>
              <div className="space-y-1">
                {items.map((content) => {
                  const meta = getPageHelpMeta(content.key);
                  const Icon = meta.icon;
                  const active = content.key === activeKey;
                  const seen = hasSeen(content.key);
                  return (
                    <button
                      key={content.key}
                      onClick={() => {
                        selectTopic(content.key);
                      }}
                      className={clsx(
                        "w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        active
                          ? "bg-primary-50 dark:bg-primary-950/40 ring-1 ring-primary-200 dark:ring-primary-800"
                          : "hover:bg-gray-100",
                      )}
                    >
                      <Icon
                        className={clsx(
                          "h-5 w-5 mt-0.5 shrink-0",
                          active
                            ? "text-primary-600 dark:text-primary-400"
                            : "text-gray-400",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={clsx(
                              "text-sm font-medium truncate",
                              active
                                ? "text-primary-900 dark:text-primary-100"
                                : "text-gray-900",
                            )}
                          >
                            {content.title}
                          </span>
                          {!seen && (
                            <span
                              className="shrink-0 h-1.5 w-1.5 rounded-full bg-primary-500"
                              title="You haven't viewed this page's guide yet"
                            />
                          )}
                        </span>
                        <span className="block text-xs text-gray-500 truncate">
                          {content.summary}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {grouped.length === 0 && (
            <EmptyState
              icon={<MagnifyingGlassIcon />}
              title="No guides match your search"
              description="Try a different search term."
              action={{
                label: "Clear search",
                onClick: () => {
                  setSearch("");
                },
              }}
            />
          )}
        </aside>

        {/* Selected guide */}
        <section
          className={clsx(mobileDetailOpen ? "block" : "hidden lg:block")}
        >
          <Card>
            <button
              onClick={() => {
                setMobileDetailOpen(false);
              }}
              className="lg:hidden flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              All guides
            </button>

            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <ActiveIcon className="h-6 w-6 text-primary-600 dark:text-primary-400 shrink-0" />
                <h3 className="text-lg font-semibold text-gray-900 truncate">
                  {activeContent.title}
                </h3>
              </div>
              {activeMeta.route && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => {
                    const { route } = activeMeta;
                    if (route) navigate(route);
                  }}
                >
                  Open page
                </Button>
              )}
            </div>

            <PageHelpBody content={activeContent} />
          </Card>
        </section>
      </div>
    </div>
  );
}
