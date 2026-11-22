import { useEffect } from "react";
import { CircleMarker, Polyline, Popup, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import type { TransitDirections, TransitPoint } from "./transitApi.ts";

export function TransitRouteLayer({ route, expanded }: { route: TransitDirections; expanded: boolean }) {
    const map = useMap();
    useEffect(() => {
        if (!route.origin) return;
        const points: [number, number][] = [[route.origin.latitude, route.origin.longitude], [route.destination.latitude, route.destination.longitude]];
        for (const leg of route.legs) {
            if (leg.type === "walk") for (const [lon, lat] of leg.geometry?.coordinates ?? []) points.push([lat, lon]);
            if (leg.type === "transit") {
                for (const s of leg.stops) points.push([s.latitude, s.longitude]);
                for (const [lon, lat] of leg.geometry?.coordinates ?? []) points.push([lat, lon]);
            }
        }
        let timer: number;
        const scheduleFit = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
            map.invalidateSize();
            map.fitBounds(L.latLngBounds(points), { padding: [26, 26], maxZoom: 15, animate: false });
            }, 100);
        };
        // The existing map expands with a 300 ms CSS transition. Fitting before
        // that transition ends clips the origin/route as the container grows.
        const observer = new ResizeObserver(scheduleFit);
        observer.observe(map.getContainer());
        scheduleFit();
        return () => { observer.disconnect(); window.clearTimeout(timer); };
    }, [route, expanded, map]);
    const stations = new Map<string, TransitPoint>();
    for (const leg of route.legs) if (leg.type === "transit") for (const s of leg.stops) stations.set(s.id ?? s.name, s);
    return <>
        {route.legs.map((leg, i) => leg.type === "transit" && leg.geometry
            ? <Polyline key={i} positions={leg.geometry.coordinates.map(([lon, lat]) => [lat, lon])} pathOptions={{ color: leg.route.color, weight: 6, opacity: 0.9 }}><Tooltip>{leg.route.name} toward {leg.headsign ?? leg.direction}</Tooltip></Polyline>
            : leg.type === "walk" ? <Polyline key={i} positions={leg.geometry ? leg.geometry.coordinates.map(([lon, lat]) => [lat, lon]) : [[leg.from.latitude, leg.from.longitude], [leg.to.latitude, leg.to.longitude]]} pathOptions={{ color: leg.geometry ? "#38bdf8" : "#94a3b8", weight: 4, dashArray: leg.geometry ? "7 5" : "2 8" }}><Tooltip>{leg.geometry ? "Geoapify pedestrian route" : "Approximate straight-line connector · not a pedestrian route"}</Tooltip></Polyline> : null)}
        {[...stations.values()].map((station) => <CircleMarker key={station.id ?? station.name} center={[station.latitude, station.longitude]} radius={5} pathOptions={{ color: "#111827", fillColor: "#ffffff", fillOpacity: 1, weight: 2 }}><Popup>{station.name}</Popup></CircleMarker>)}
        {route.legs.filter((leg) => leg.type === "transfer").map((leg, i) => <CircleMarker key={`transfer-${i}`} center={[leg.station.latitude, leg.station.longitude]} radius={9} pathOptions={{ color: "#fbbf24", weight: 3, fillOpacity: 0 }}><Popup>Transfer at {leg.station.name}</Popup></CircleMarker>)}
        <CircleMarker center={[route.destination.latitude, route.destination.longitude]} radius={9} pathOptions={{ color: "#1DB954", fillColor: "#1DB954", fillOpacity: 1 }}><Popup>{route.destination.name}</Popup></CircleMarker>
    </>;
}
