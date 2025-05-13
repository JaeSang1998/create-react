import { createElement, render } from "./myReact";

render(
  createElement("h1", { id: "foo" }, "Hello"),
  document.getElementById("root")!
);
