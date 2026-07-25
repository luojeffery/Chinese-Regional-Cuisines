(function attachInputEvents(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MapInputEvents = api;
})(typeof window !== "undefined" ? window : globalThis, function createInputEventsApi() {
  function isPrimaryButtonEvent(event) {
    return event.button === undefined || event.button === 0;
  }

  return { isPrimaryButtonEvent };
});
