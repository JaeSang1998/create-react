import {
  createElement,
  render,
  useEffect,
  useState,
  useTransition,
  flushUpdate,
  Lane,
} from "./myReact";

interface ListProps {
  items: string[];
}

function Item({ item }: { item: string }) {
  const [count, setCount] = useState(0);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    console.log("count mounted", count);
    return () => {
      console.log("count unmounted", count);
    };
  }, [count]);

  return createElement(
    "li",
    {
      key: item,
      onClick: () => {
        setCount(count + 1);
        setIsActive(!isActive);
      },
      style: { color: isActive ? "red" : "black" },
    },
    `${item} (${count})`
  );
}

function List({ items }: ListProps) {
  return createElement(
    "ul",
    null,
    ...items.map((item) => createElement(Item, { key: item, item }))
  );
}

function App() {
  const [text, setText] = useState("");
  const [list, setList] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: Event) => {
    const newText = (e.target as HTMLInputElement).value;
    // Immediate update for input
    flushUpdate(() => setText(newText), Lane.Immediate);

    // Transition update for list
    startTransition(() => {
      const numbers = Array.from({ length: 20000 }, (_, i) => newText + i);
      setList(numbers);
    });
  };

  return createElement(
    "div",
    null,
    createElement("input", { value: text, onInput: handleChange }),
    createElement(
      "div",
      { style: { opacity: isPending ? 0.5 : 1 } },
      isPending ? "Loading..." : null,
      ...list.map((item) => createElement("div", { key: item }, item))
    )
  );
}

const root = document.getElementById("root");

if (root) {
  const items = ["apple", "banana", "orange"];
  const element = createElement(App, {});
  render(element, root);
}
