export type ElementType = string | symbol | Function | null;

export type VNode = {
  type: ElementType;
  props: {
    children: VNode[];
    [key: string]: any;
  };
};

const TEXT_ELEMENT = Symbol("TEXT_ELEMENT");

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
