import { useCallback, useEffect, useRef, useState } from "react";
import { searchAddresses } from "./transitApi.ts";
import type { AddressSuggestion } from "./transitApi.ts";

export function TransitAddressSearch({ onSelect }: { onSelect: (address: AddressSuggestion) => void }) {
    const [query, setQuery] = useState("");
    const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
    const [active, setActive] = useState(-1);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [selected, setSelected] = useState(false);
    const request = useRef<AbortController | null>(null);
    const search = useCallback(async (text: string, mode: "autocomplete" | "geocode") => {
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        const timeout = window.setTimeout(() => controller.abort(), 12_000);
        setLoading(true);
        setMessage("");
        try {
            const results = await searchAddresses(text.trim(), mode, controller.signal);
            if (request.current !== controller) return;
            setSuggestions(results);
            setActive(-1);
            setMessage(results.length ? "Choose an address to confirm your starting point." : "No local addresses found. Add a street number or city.");
        } catch (error) {
            if (request.current === controller) setMessage(controller.signal.aborted ? "Address search timed out. Please try again." : error instanceof Error ? error.message : "Address search failed.");
        } finally {
            window.clearTimeout(timeout);
            if (request.current === controller) setLoading(false);
        }
    }, []);
    useEffect(() => {
        if (query.trim().length < 3 || selected) return;
        const timer = window.setTimeout(() => void search(query, "autocomplete"), 350);
        return () => {
            window.clearTimeout(timer);
            request.current?.abort();
            request.current = null;
        };
    }, [query, selected, search]);
    const choose = (address: AddressSuggestion) => {
        setSelected(true); setQuery(address.label); setSuggestions([]); setMessage(""); onSelect(address);
    };
    return <form className="transit-address" onSubmit={(event) => {
        event.preventDefault();
        if (active >= 0 && suggestions[active]) choose(suggestions[active]);
        else if (query.trim().length >= 3) void search(query, "geocode");
    }}>
        <label htmlFor="transit-address">Starting address or place</label>
        <div className="transit-search-row"><input id="transit-address" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls="transit-suggestions" aria-activedescendant={active >= 0 ? `transit-address-${active}` : undefined}
            value={query} autoComplete="off" placeholder="Boston University or a street address" maxLength={200}
            onChange={(event) => { request.current?.abort(); request.current = null; setQuery(event.target.value); setSelected(false); setSuggestions([]); setMessage(""); setLoading(false); setActive(-1); }}
            onKeyDown={(event) => {
                if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length) { event.preventDefault(); setActive((value) => Math.max(0, Math.min(suggestions.length - 1, value + (event.key === "ArrowDown" ? 1 : -1)))); }
                if (event.key === "Escape" && suggestions.length) { event.preventDefault(); event.stopPropagation(); setSuggestions([]); setActive(-1); }
            }} />
            <button type="submit" disabled={query.trim().length < 3 || loading}>Search</button></div>
        {loading && <p role="status">Searching addresses…</p>}
        {message && <p role="status">{message}</p>}
        <ul id="transit-suggestions" role="listbox" aria-label="Matching starting addresses">{suggestions.map((suggestion, index) => <li key={`${suggestion.id}-${index}`}>
            <button id={`transit-address-${index}`} type="button" role="option" aria-selected={active === index} onMouseEnter={() => setActive(index)} onClick={() => choose(suggestion)}>{suggestion.label}</button>
        </li>)}</ul>
        <small>Greater Boston · Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · © OpenStreetMap contributors</small>
    </form>;
}
