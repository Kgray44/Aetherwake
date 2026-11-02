const { ipcRenderer } = require("electron");
const token = process.argv
  .find((value) => value.startsWith("--vela-review-token="))
  ?.slice(20);
let settled = false;
const decide = (decision) => {
  if (settled || !token) return;
  settled = true;
  ipcRenderer.send("vela-review-decision", { token, decision });
};
addEventListener(
  "DOMContentLoaded",
  () => {
    document
      .getElementById("cancel")
      .addEventListener("click", () => decide("cancel"));
    document
      .getElementById("approve")
      .addEventListener("click", () => decide("approve"));
    document.getElementById("cancel").focus({ preventScroll: true });
    addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        decide("cancel");
      }
    });
  },
  { once: true },
);
