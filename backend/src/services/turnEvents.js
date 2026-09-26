// Project UI cards from the canonical transcript, including records saved before
// exact airport resolution was introduced. Never alter the model/tool messages.
export function toTurnEvents(messages) {
  const calls = new Map();
  const airportCodes = new Set();
  const events = [];
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) calls.set(call.id, call.function);
    if (message.role !== "tool") continue;
    const call = calls.get(message.tool_call_id);
    if (!call) continue;
    let result = JSON.parse(message.content);
    if (call.name === "search_airports" && result.ok) {
      let query = "";
      try {
        query = JSON.parse(call.arguments).query?.trim().toLowerCase() ?? "";
      } catch {
        /* Failed argument parsing has no query to use as a filter. */
      }
      const airports = Array.isArray(result.data?.airports)
        ? result.data.airports.filter((airport) => airport && typeof airport.iataCode === "string")
        : [];
      const exact = airports.filter((airport) =>
        [airport.iataCode, airport.cityName, airport.name].some(
          (value) => typeof value === "string" && value.toLowerCase() === query,
        ),
      );
      // A three-letter code must not resolve to "Shaheed" or "Marshall" by substring.
      // Retain older full-name partial searches when no exact city/name match exists.
      const candidates = /^[a-z]{3}$/.test(query) ? exact : exact.length ? exact : airports;
      const unique = candidates.filter((airport) => {
        const code = airport.iataCode.toUpperCase();
        if (airportCodes.has(code)) return false;
        airportCodes.add(code);
        return true;
      });
      if (!unique.length) continue;
      result = { ...result, data: { ...result.data, airports: unique } };
    }
    events.push({ tool: call.name, result });
  }
  return events;
}
