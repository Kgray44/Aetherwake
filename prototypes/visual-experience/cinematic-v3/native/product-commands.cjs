const reads = Object.freeze({
  agents: Object.freeze([
    "list",
    "templates",
    "projects",
    "catalog",
    "inspect",
    "effective",
    "assignment",
  ]),
  checklists: Object.freeze(["read"]),
  timelines: Object.freeze(["read", "query"]),
  taskObjectives: Object.freeze(["read", "history", "list"]),
});
const writes = Object.freeze({
  agents: Object.freeze(["create", "update", "archive", "recordAssignment"]),
  checklists: Object.freeze(["create", "mutate"]),
  timelines: Object.freeze(["create", "save"]),
  taskObjectives: Object.freeze(["create", "mutate"]),
});
function validEnvelope(family, value) {
  return (
    Object.hasOwn(reads, family) &&
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    Object.hasOwn(value, "name") &&
    Object.hasOwn(value, "input") &&
    typeof value.name === "string" &&
    value.input &&
    typeof value.input === "object" &&
    !Array.isArray(value.input)
  );
}
function isProductRead(family, input) {
  return !!(validEnvelope(family, input) && reads[family].includes(input.name));
}
async function productCommand({ family, input, call }) {
  if (
    !validEnvelope(family, input) ||
    ![...reads[family], ...writes[family]].includes(input.name)
  )
    throw Error("unsupported_product_command");
  // No execution or credential authority. The canonical services validate exact
  // operation inputs and current source permissions before reading or mutating.
  return call(family, input);
}
module.exports = { isProductRead, productCommand };
