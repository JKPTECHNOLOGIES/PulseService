import { useMemo } from "react";
import { format, addDays } from "date-fns";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useDispatchBoard } from "../hooks/useDispatch";
import api from "../lib/api";
import { directionsUrl } from "../lib/maps";
import { getErrorMessage } from "../lib/errors";
import Button from "../components/ui/Button";
import { PageSpinner } from "../components/ui/Spinner";
import type { ApiResponse, Job } from "../types";

// Seed data is Atlanta-based; used as the default center when nothing is mapped.
const DEFAULT_CENTER: [number, number] = [33.749, -84.388];

const jobPin = L.divIcon({
  className: "",
  html: '<div style="background:#2563eb;width:14px;height:14px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 18],
  popupAnchor: [0, -16],
});

export default function MapPage() {
  const from = format(new Date(), "yyyy-MM-dd");
  const to = format(addDays(new Date(), 14), "yyyy-MM-dd");
  const { data: board, isLoading, refetch } = useDispatchBoard(from, to);

  const points = useMemo(() => {
    const all: Job[] = board
      ? [
          ...board.technicians.flatMap((t) => t.jobs),
          ...board.unassigned,
          ...board.undated,
        ]
      : [];
    const out: { job: Job; lat: number; lng: number }[] = [];
    for (const j of all) {
      const lat = j.location?.lat;
      const lng = j.location?.lng;
      if (typeof lat === "number" && typeof lng === "number") {
        out.push({ job: j, lat, lng });
      }
    }
    return out;
  }, [board]);

  const geocodeMutation = useMutation({
    mutationFn: () =>
      api.post<ApiResponse<{ updated: number; scanned: number }>>(
        "/geocode/backfill",
      ),
    onSuccess: (res) => {
      toast.success(`Geocoded ${String(res.data.updated)} address(es)`);
      void refetch();
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Geocoding failed"));
    },
  });

  const center: [number, number] = points[0]
    ? [points[0].lat, points[0].lng]
    : DEFAULT_CENTER;

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {points.length} mapped job{points.length === 1 ? "" : "s"} (next 14
          days)
        </p>
        <Button
          variant="outline"
          size="sm"
          loading={geocodeMutation.isPending}
          onClick={() => {
            geocodeMutation.mutate();
          }}
        >
          Geocode addresses
        </Button>
      </div>

      <div
        className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"
        style={{ height: "70vh" }}
      >
        <MapContainer
          center={center}
          zoom={11}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {points.map((p) => (
            <Marker key={p.job.id} position={[p.lat, p.lng]} icon={jobPin}>
              <Popup>
                <div className="text-sm space-y-0.5">
                  <Link
                    to={`/jobs/${p.job.id}`}
                    className="font-semibold text-primary-600"
                  >
                    #{p.job.jobNumber}
                  </Link>
                  <p className="text-gray-800">{p.job.summary}</p>
                  {p.job.customer && (
                    <p className="text-gray-500">
                      {p.job.customer.firstName} {p.job.customer.lastName}
                    </p>
                  )}
                  {p.job.location && (
                    <p className="text-gray-500">
                      {p.job.location.address}, {p.job.location.city}
                    </p>
                  )}
                  <a
                    href={directionsUrl([
                      p.job.location?.address,
                      p.job.location?.city,
                      p.job.location?.state,
                      p.job.location?.zip,
                    ])}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-600 underline"
                  >
                    Directions
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {points.length === 0 && (
        <p className="text-sm text-gray-400 text-center">
          No mapped jobs yet. Click “Geocode addresses” to plot customer
          locations from their addresses, then schedule jobs there.
        </p>
      )}
    </div>
  );
}
