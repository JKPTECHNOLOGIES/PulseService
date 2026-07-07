import { useRef, useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpTrayIcon, DocumentArrowDownIcon } from "@heroicons/react/24/outline";
import toast from "../../lib/toast";
import api from "../../lib/api";
import { getErrorMessage } from "../../lib/errors";
import { parseCsv } from "../../utils/csvImport";
import { downloadCsv } from "../../utils/csv";
import type { ApiResponse } from "../../types";
import Modal from "./Modal";
import Button from "./Button";

interface ImportResult {
  created: number;
  failed: number;
  errors: { row: number; error: string }[];
}

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  endpoint: string;
  invalidateKey: QueryKey;
  /** Column headers used for the downloadable template + on-screen hint. */
  templateColumns: string[];
}

export default function ImportModal({
  isOpen,
  onClose,
  title,
  endpoint,
  invalidateKey,
  templateColumns,
}: ImportModalProps) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setRows([]);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setRows(parseCsv(text));
    setResult(null);
  };

  const runImport = async () => {
    if (rows.length === 0) return;
    setBusy(true);
    try {
      const res = await api.post<ApiResponse<ImportResult>>(endpoint, { rows });
      setResult(res.data);
      void qc.invalidateQueries({ queryKey: invalidateKey });
      if (res.data.created > 0) {
        toast.success(`Imported ${String(res.data.created)} record(s)`);
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Import failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        reset();
        onClose();
      }}
      title={title}
      size="lg"
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-gray-500">
            Upload a CSV with a header row. Columns:{" "}
            <span className="font-mono text-xs text-gray-700">
              {templateColumns.join(", ")}
            </span>
          </p>
          <button
            type="button"
            onClick={() => {
              downloadCsv(
                "import-template",
                [],
                templateColumns.map((c) => ({ header: c, value: () => "" })),
              );
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 shrink-0"
          >
            <DocumentArrowDownIcon className="h-4 w-4" />
            Template
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
          }}
          className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-700 hover:file:bg-primary-100"
        />

        {rows.length > 0 && !result && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 text-sm text-gray-700">
            Detected <span className="font-semibold">{rows.length}</span> row(s)
            with columns:{" "}
            <span className="font-mono text-xs">
              {Object.keys(rows[0]).join(", ")}
            </span>
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-gray-100 px-4 py-3 text-sm space-y-2">
            <p className="text-gray-800">
              <span className="font-semibold text-green-600">
                {result.created} created
              </span>
              {result.failed > 0 && (
                <span className="font-semibold text-red-600">
                  {" "}
                  · {result.failed} failed
                </span>
              )}
            </p>
            {result.errors.length > 0 && (
              <ul className="max-h-40 overflow-y-auto text-xs text-red-600 space-y-0.5">
                {result.errors.slice(0, 50).map((e) => (
                  <li key={e.row}>
                    Row {e.row}: {e.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && (
            <Button
              icon={<ArrowUpTrayIcon className="h-4 w-4" />}
              loading={busy}
              disabled={rows.length === 0}
              onClick={() => {
                void runImport();
              }}
            >
              Import {rows.length > 0 ? `${String(rows.length)} rows` : ""}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
