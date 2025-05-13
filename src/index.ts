import { createElement, render, useEffect, useState } from "./myReact";

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

const root = document.getElementById("root");

if (root) {
  const items = ["apple", "banana", "orange"];
  const element = createElement(List, { items });
  render(element, root);
}
