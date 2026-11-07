import { createRoot } from "react-dom/client";
import App from "./App";
import { MergeWindow } from "./MergeWindow";
import "./style.css";

const root = document.getElementById("root");
if (!root) throw new Error("the page has no #root");

// A merge window loads "/?merge=<path>": one conflict, no docks.
const merge = new URLSearchParams(window.location.search).get("merge");
createRoot(root).render(merge ? <MergeWindow path={merge} /> : <App />);
