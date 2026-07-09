// Global LIFO registry for dismissible ephemeral UI - open FAB menus and any
// sheet - that the App-level declarative backStack can't observe (they live in
// child components' local state). The hardware BACK button peels these FIRST,
// most-recently-opened first, so back always closes the topmost visible layer.
//
// A consumer returns true when it actually dismissed something (stop here); any
// other return lets back fall through to the next consumer, then the backStack.
const consumers = [];

export function registerBackConsumer(fn) {
  consumers.push(fn);
  return () => {
    const i = consumers.indexOf(fn);
    if (i >= 0) consumers.splice(i, 1);
  };
}

export function runBackConsumers() {
  for (let i = consumers.length - 1; i >= 0; i--) {
    if (consumers[i]() === true) return true;
  }
  return false;
}
