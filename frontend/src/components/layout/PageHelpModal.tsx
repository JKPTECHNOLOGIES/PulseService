import { Link } from "react-router-dom";
import { BookOpenIcon } from "@heroicons/react/24/outline";
import Modal from "../ui/Modal";
import PageHelpBody from "./PageHelpBody";
import { PageHelpContent } from "../../content/pageHelp";

interface PageHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: PageHelpContent;
}

/** Simple, plain-English "how does this page work" guide shown in a modal. */
export default function PageHelpModal({
  isOpen,
  onClose,
  content,
}: PageHelpModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${content.title} help`}
      size="lg"
    >
      <PageHelpBody content={content} />
      <Link
        to={`/help?topic=${content.key}`}
        onClick={onClose}
        className="mt-5 flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
      >
        <BookOpenIcon className="h-4 w-4" />
        Browse all page guides
      </Link>
    </Modal>
  );
}
