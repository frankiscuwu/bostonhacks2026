import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, MapPin, TrainFront, X } from "lucide-react";
import type { Restaurant } from "./data.ts";
import type { LatLng } from "./restaurantsApi.ts";
import { TransitAddressSearch } from "./TransitAddressSearch.tsx";
import type { RoomSession } from "./roomsApi.ts";
import { fetchTransitDirections } from "./transitApi.ts";
import type { TransitDirections, TransitLeg, TransitLine } from "./transitApi.ts";
import "./TransitDirections.css";

function LineBadge({ line }: { line: TransitLine }) {
    return <span className="transit-line"><span style={{ background: line.color }} />{line.name}</span>;
}

function DepartureTimes({ leg }: { leg: TransitLeg }) {
    if (!leg.departures.length) return <p className="transit-muted">No matching departures available. Confirm service before traveling.</p>;
    return <div className="transit-departures">
        <p>{leg.departure_source === "realtime" ? "Live MBTA departures" : "Scheduled departures · not live"}</p>
        <div>{leg.departures.map((departure, i) => <span key={`${departure.time}-${i}`}>
            {new Date(departure.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}
        </span>)}</div>
        <small>Boston time · {leg.departure_is_feasible ? "Boarding allowance included; check platform signs" : "Informational departures; catchability not verified"}</small>
    </div>;
}

type Props = {
    restaurant: Restaurant; roomCode: string | null; session: RoomSession | null;
    deviceLocation: LatLng | null; onClose: () => void;
    onRoute: (route: TransitDirections | null) => void;
    onRefreshRoom: () => void;
};

export function TransitDirectionsPanel({ restaurant, roomCode, session, deviceLocation, onClose, onRoute, onRefreshRoom }: Props) {
    const [data, setData] = useState<TransitDirections | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [latitude, setLatitude] = useState(() => deviceLocation ? String(deviceLocation.latitude) : "");
    const [longitude, setLongitude] = useState(() => deviceLocation ? String(deviceLocation.longitude) : "");
    const [originLabel, setOriginLabel] = useState("Your saved Jam location");
    const [editing, setEditing] = useState(false);
    const [locating, setLocating] = useState(false);
    const requestRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(false);
    const lastOriginRef = useRef<LatLng | "saved">("saved");
    const load = useCallback(async (origin: LatLng | "saved") => {
        lastOriginRef.current = origin;
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        const timeout = window.setTimeout(() => controller.abort(), 60_000);
        setLoading(true);
        setError("");
        setData(null);
        onRoute(null);
        try {
            const startingPoint = origin === "saved"
                ? roomCode && session ? { roomCode, token: session.token } : null
                : origin;
            const response = await fetchTransitDirections(restaurant.id, startingPoint, controller.signal);
            if (requestRef.current !== controller) return;
            setData(response);
            onRoute(response.status === "ok" ? response : null);
        } catch (cause) {
            if (requestRef.current !== controller) return;
            setError(controller.signal.aborted ? "The request timed out. MBTA data may still be warming; please retry."
                : cause instanceof Error ? cause.message : "Unable to load directions.");
        } finally {
            window.clearTimeout(timeout);
            if (requestRef.current === controller) setLoading(false);
        }
    }, [restaurant.id, roomCode, session, onRoute]);

    useEffect(() => {
        mountedRef.current = true;
        const timer = window.setTimeout(() => void load("saved"), 0);
        return () => {
            mountedRef.current = false;
            window.clearTimeout(timer);
            const active = requestRef.current;
            requestRef.current = null;
            active?.abort();
        };
    }, [load]);

    useEffect(() => {
        const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("keydown", closeOnEscape);
        return () => window.removeEventListener("keydown", closeOnEscape);
    }, [onClose]);

    const needsOrigin = editing || data?.status === "origin_required";
    const useDeviceLocation = () => {
        if (deviceLocation) {
            setEditing(false);
            setOriginLabel("Current location");
            void load(deviceLocation);
            return;
        }
        if (!navigator.geolocation) {
            setError("Device location is unavailable. Search for an address or use advanced coordinates instead.");
            return;
        }
        setLocating(true);
        setError("");
        navigator.geolocation.getCurrentPosition((position) => {
            if (!mountedRef.current) return;
            setLocating(false);
            setEditing(false);
            setOriginLabel("Current location");
            void load({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        }, () => {
            if (!mountedRef.current) return;
            setLocating(false);
            setError("Could not access device location. Allow location access in your browser or search for an address instead.");
        }, { timeout: 10_000, maximumAge: 60_000 });
    };
    return <section className="transit-panel" role="dialog" aria-modal="false" aria-labelledby="transit-title">
        <header className="transit-header">
            <div><span className="transit-eyebrow"><TrainFront size={15} /> YOUR WAY THERE</span>
                <h2 id="transit-title">Your journey</h2><p>Walk + MBTA</p></div>
            <button onClick={onClose} className="transit-icon" aria-label="Close directions"><X size={20} /></button>
        </header>
        <div className="transit-content">
            <p className="transit-private"><MapPin size={15} /> Your starting point stays private. Everyone in the Jam has their own route.</p>
            <div className="transit-endpoints"><p><span>FROM</span><strong>{data?.status === "origin_required" ? "Choose a starting address" : originLabel}</strong></p><p><span>TO</span><strong>{restaurant.name}</strong></p></div>
            <div className="transit-actions">
                <button onClick={() => { setEditing(false); setOriginLabel("Your saved Jam location"); void load("saved"); }} disabled={loading}>Use my saved location</button>
                <button onClick={() => setEditing((value) => !value)}>Choose starting point</button>
            </div>
            {needsOrigin && <div className="transit-origin">
                <TransitAddressSearch onSelect={(address) => { setOriginLabel(address.label); setEditing(false); void load(address); }} />
                <button type="button" disabled={loading || locating} onClick={useDeviceLocation}>{locating ? "Locating device…" : "Use my current location"}</button>
                <details className="transit-advanced"><summary>Advanced: enter coordinates</summary><form onSubmit={(event) => {
                    event.preventDefault();
                    const lat = Number(latitude), lon = Number(longitude);
                    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { setError("Enter valid coordinates."); return; }
                    setOriginLabel("Custom starting point"); setEditing(false); void load({ latitude: lat, longitude: lon });
                }}><div className="transit-coordinate-row"><label>Latitude<input type="number" step="any" min="-90" max="90" value={latitude} onChange={(e) => setLatitude(e.target.value)} required /></label>
                    <label>Longitude<input type="number" step="any" min="-180" max="180" value={longitude} onChange={(e) => setLongitude(e.target.value)} required /></label></div>
                    <button type="submit" disabled={loading}>Find my route</button></form></details>
            </div>}
            {loading && <div className="transit-state" role="status"><span className="transit-spinner" />Finding a rail route…<small>Loading MBTA stops, branches and service information.</small></div>}
            {error && <div className="transit-state transit-error" role="alert"><AlertTriangle size={22} /><p>{error}</p>
                <button onClick={() => void load(lastOriginRef.current)}>Retry</button><button onClick={onRefreshRoom}>Refresh Jam</button></div>}
            {data && data.status !== "ok" && data.status !== "origin_required" && <div className="transit-state" role="status"><TrainFront size={26} />
                <h3>{data.status === "no_route" ? "No supported rail route" : data.status === "unsupported" ? "Outside our rail coverage" : "MBTA data is unavailable"}</h3>
                <p>Red, Orange, Blue and Green B/C/D/E · at most one transfer.</p>
                {data.status === "unavailable" && <p>{data.warnings.find((item) => !["approximate_walking", "normal_service_pattern"].includes(item.code))?.message}</p>}
                <button onClick={() => void load(lastOriginRef.current)}>Try again</button>
            </div>}
            {data?.status === "ok" && <>
                <div className="transit-summary">
                    <strong className="transit-eta">{data.eta?.status === "complete" ? `${data.summary?.duration_minutes} min by T` : "ETA unavailable"}</strong>
                    {data.eta?.arrival_time && <span>Arrive around {new Date(data.eta.arrival_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}</span>}
                    <div className="transit-line-sequence">{data.legs.filter((leg) => leg.type === "transit").map((leg, index) => <span key={index}>{index > 0 && <ArrowRight size={14} />}<LineBadge line={leg.route} /></span>)}</div>
                    <span>{data.summary?.transfers === 0 ? "Direct train" : "One transfer"}{data.eta?.status === "complete" && ` · ${Math.ceil((data.eta.walking_seconds ?? 0) / 60)} min walking · ${Math.ceil((data.eta.waiting_seconds ?? 0) / 60)} min waiting · ${Math.ceil((data.eta.transit_seconds ?? 0) / 60)} min on T`}</span>
                    <small>{data.eta?.status === "complete" ? `Estimated walking + ${data.eta.source === "realtime" ? "live MBTA timings" : data.eta.source === "mixed" ? "live and scheduled MBTA timings" : "scheduled MBTA timings (not live)"}. Includes a 1 min boarding allowance. Not a guarantee.` : data.eta?.reason?.replaceAll("_", " ") ?? "Complete walking and train times are not available."}</small>
                    {data.alerts.some((alert) => ["SUSPENSION", "SHUTTLE"].includes(alert.effect ?? "")) && <p className="transit-service-warning">Service disruption reported. Normal route shown; check advisories before traveling.</p>}
                </div>
                <ol className="transit-legs">{data.legs.map((leg, index) => <li key={index}>
                    <span className="transit-step">{index + 1}</span>
                    {leg.type === "walk" ? <div><h3>Walk {leg.duration_seconds != null ? `${Math.ceil(leg.duration_seconds / 60)} min` : "toward"} to {leg.to.name}</h3><p>{leg.distance_basis === "pedestrian_route" ? `${leg.distance_m} m · Geoapify pedestrian route` : `~${leg.approximate_distance_m} m straight-line approximation · walking time unavailable`}</p>{!!leg.steps?.length && <details><summary>Walking details</summary><ul>{leg.steps.map((step, i) => <li key={i}>{step}</li>)}</ul></details>}</div>
                        : leg.type === "transfer" ? <div><h3>Change at {leg.station.name}</h3><LineBadge line={leg.from_route} /> <ArrowRight size={13} /> <LineBadge line={leg.to_route} /><small>{leg.instruction}</small></div>
                        : <div><LineBadge line={leg.route} /><h3>Take {leg.route.name} from {leg.from.name}</h3><p>Exit at {leg.to.name}{leg.timing ? ` · ${Math.ceil(leg.timing.duration_seconds / 60)} min on train` : ""}</p><p>Toward {leg.headsign ?? leg.direction ?? "the indicated platform destination"}{leg.direction ? ` · ${leg.direction}` : ""}</p>
                            <details><summary>{leg.stop_count} stops · see station sequence</summary><p>{leg.stops.map((s) => s.name).join(" → ")}</p></details><DepartureTimes leg={leg} /></div>}
                </li>)}</ol>
                <button className="transit-primary" onClick={onClose}>Show route on map <ArrowRight size={16} /></button>
                <p className="transit-muted">Colored lines: MBTA. Blue dashed paths: pedestrian routes. Gray dotted connectors: straight-line approximations.</p>
            </>}
            {data && data.alerts.length > 0 && <details className="transit-advisory">
                <summary>Service advisories ({data.alerts.length}) · normal route shown</summary>
                {data.alerts.map((alert) => <div key={alert.id}><strong>{alert.effect?.replaceAll("_", " ") ?? "Service advisory"}</strong><p>{alert.header}</p>
                    {alert.url?.startsWith("https://www.mbta.com/") && <a href={alert.url} target="_blank" rel="noopener noreferrer">MBTA advisory ↗</a>}</div>)}
            </details>}
            {data && data.warnings.length > 0 && <details className="transit-warnings"><summary>Route notes & limitations ({data.warnings.length})</summary><ul>{data.warnings.map((item, i) => <li key={`${item.code}-${i}`}>{item.message}</li>)}</ul></details>}
        </div>
    </section>;
}
