// Project UI cards from tool results without reinterpreting query intent.
// Never alter the model/tool messages.
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
      const airports = Array.isArray(result.data?.airports)
        ? result.data.airports.filter((airport) => airport && typeof airport.iataCode === "string")
        : [];
      const unique = airports.filter((airport) => {
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
