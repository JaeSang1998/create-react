export type ElementType = string | symbol | Function | null;

export type VNode = {
  type: ElementType;
  props: {
    children: VNode[];
    [key: string]: any;
  };
};

const TEXT_ELEMENT = Symbol("TEXT_ELEMENT");

export const render = (vNode: VNode, container: Element | DocumentFragment) => {
  const dom: Node =
    vNode.type === TEXT_ELEMENT
      ? document.createTextNode(vNode.props.value)
      : document.createElement(vNode.type as string);

  const isProperty = (key: string) => key !== "children";
  Object.keys(vNode.props)
    .filter(isProperty)
    .forEach((name) => {
      (dom as any)[name] = vNode.props[name];
    });

  vNode.props.children.forEach((child: VNode) => {
    render(child, dom as Element);
  });

  container.appendChild(dom);
};

const createTextElement = (text: string): VNode => {
  return {
    type: TEXT_ELEMENT,
    props: {
      nodeValue: text,
      children: [],
    },
  };
};

export const createElement = (
  type: ElementType,
  props: { [key: string]: any } | null,
  ...children: any[]
): VNode => {
  const childrenElements = children
    .filter((child) => !!child)
    .map((child) => {
      if (typeof child === "object" && child.type) {
        return child as VNode;
      }
      return createTextElement(child as string);
    });

  return {
    type,
    props: {
      ...props,
      children: childrenElements,
    },
  };
};
