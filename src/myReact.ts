export type ElementType = string | symbol | Function | null;

export type VNode = {
  type: ElementType;
  props: {
    children: VNode[];
    [key: string]: any;
  };
  dom?: Node | null;
};

let currentRoot: VNode | null = null;
const TEXT_ELEMENT = Symbol("TEXT_ELEMENT");

export const render = (vNode: VNode, container: Element | DocumentFragment) => {
  reconcile(container, currentRoot, vNode);
  currentRoot = vNode;
};

const reconcile = (
  parent: Node,
  oldVNode: VNode | null,
  newVNode: VNode | null
): void => {
  // Mount
  if (oldVNode === null) {
    if (newVNode === null) return;
    const dom = createDOM(newVNode);
    parent.appendChild(dom);
    newVNode.props.children.forEach((child: VNode) => {
      reconcile(dom, null, child);
    });
    return;
  }

  // UnMount
  if (newVNode === null) {
    parent.removeChild(oldVNode.dom!);
    return;
  }

  // Replace <- 돔 교체
  if (
    oldVNode !== null &&
    newVNode !== null &&
    oldVNode.type !== newVNode.type
  ) {
    const dom = createDOM(newVNode);
    newVNode.dom = dom;
    parent.replaceChild(dom, oldVNode.dom!);
    newVNode.props.children.forEach((child: VNode) => {
      reconcile(dom, null, child);
    });
    return;
  }

  // update <- type 같음 돔 업데이트
  const dom = (newVNode.dom = oldVNode.dom!);
  updateDOMProps(dom, oldVNode!.props, newVNode!.props);
  reconcileChildren(dom, oldVNode.props.children, newVNode.props.children);
};

const reconcileChildren = (
  parent: Node,
  oldKids: VNode[],
  newKids: VNode[]
) => {
  const max = Math.max(oldKids.length, newKids.length);
  for (let i = 0; i < max; i++) {
    reconcile(parent, oldKids[i], newKids[i]);
  }
};

const createDOM = (vNode: VNode): Node =>
  vNode.type === TEXT_ELEMENT
    ? document.createTextNode(vNode.props.value)
    : document.createElement(vNode.type as string);

const createTextElement = (text: string): VNode => {
  return {
    type: TEXT_ELEMENT,
    props: {
      value: text,
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

const eventListeners = new WeakMap<Node, Record<string, EventListener>>();
/**
 * 이전 가상 DOM props와 새 props를 비교해
 * 실제 DOM 노드의 속성·이벤트·스타일을 동기화합니다.
 *
 * @param dom       실제 갱신 대상 DOM 노드
 * @param prevProps 직전 렌더링 시점의 props
 * @param nextProps 이번 렌더링 시점의 props
 */
function updateDOMProps(
  dom: Node,
  prevProps: Record<string, any>,
  nextProps: Record<string, any>
) {
  const el = dom as HTMLElement;

  /**
   * 전역 WeakMap<HTMLElement, Record<string, EventListener>>
   * 각 노드에 연결된 이벤트 리스너를 추적해
   * 중복 바인딩과 메모리 누수를 방지합니다.
   */
  const currentListeners = eventListeners.get(el) ?? {};

  /* ------------------------------------------------------------------
   * 1단계: nextProps에 사라졌거나 값이 달라진 이전 속성·리스너 제거
   * ----------------------------------------------------------------*/
  Object.keys(prevProps).forEach((key) => {
    if (key === "children" || key === "key") return; // 가상 DOM 전용 필드

    const prevVal = prevProps[key];
    const nextVal = nextProps[key];

    if (!(key in nextProps) || prevVal !== nextVal) {
      if (key.startsWith("on")) {
        /* 이벤트:  remove → 캐시 정리 */
        const type = key.slice(2).toLowerCase();
        el.removeEventListener(type, prevVal as EventListener);
        delete currentListeners[type];
      } else if (key === "style") {
        /* style: 전체 초기화(개별 diff는 2단계에서 처리) */
        el.style.cssText = "";
      } else if (key === "className") {
        el.removeAttribute("class");
      } else {
        el.removeAttribute(key);
      }
    }
  });

  /* ------------------------------------------------------------------
   * 2단계: 새로 추가되었거나 값이 바뀐 속성·리스너 적용
   * ----------------------------------------------------------------*/
  Object.keys(nextProps).forEach((key) => {
    if (key === "children" || key === "key") return;

    const prevVal = prevProps[key];
    const nextVal = nextProps[key];

    // style 객체는 깊이 비교가 필요하므로 제외
    if (
      prevVal === nextVal &&
      (typeof nextVal !== "object" || nextVal === null) &&
      key !== "style"
    )
      return;

    if (key.startsWith("on")) {
      /* 이벤트: 이전 리스너가 있으면 교체 */
      const type = key.slice(2).toLowerCase();
      if (prevVal) el.removeEventListener(type, prevVal as EventListener);
      if (nextVal) {
        el.addEventListener(type, nextVal as EventListener);
        currentListeners[type] = nextVal as EventListener;
      }
    } else if (key === "style") {
      applyStyle(el, prevVal ?? {}, nextVal);
    } else if (key === "className") {
      nextVal
        ? el.setAttribute("class", String(nextVal))
        : el.removeAttribute("class");
    } else {
      /* 일반 속성: boolean true → 빈 문자열, false/null/undefined → 제거 */
      if (nextVal === null || nextVal === undefined || nextVal === false) {
        el.removeAttribute(key);
      } else {
        el.setAttribute(
          key,
          typeof nextVal === "boolean" ? "" : String(nextVal)
        );
      }
    }
  });

  /* ------------------------------------------------------------------
   * 3단계: 이벤트 리스너 캐시 정리
   * ----------------------------------------------------------------*/
  if (Object.keys(currentListeners).length) {
    eventListeners.set(el, currentListeners);
  } else {
    eventListeners.delete(el);
  }
}

/**
 * style 객체 간 diff를 계산해 HTMLElement.style에 반영합니다.
 * - nextStyle이 객체가 아니면 cssText 전체 교체
 * - 객체인 경우 사라진 속성 제거 후 변경·추가 속성 반영
 */
function applyStyle(
  el: HTMLElement,
  prevStyle: Record<string, any>,
  nextStyle: any
) {
  if (typeof nextStyle !== "object" || nextStyle === null) {
    el.style.cssText = nextStyle || "";
    return;
  }

  const styleDecl = el.style;

  // 1) 사라진 속성 제거
  for (const name in prevStyle) {
    if (!(name in nextStyle)) styleDecl[name as any] = "";
  }
  // 2) 새로 추가되거나 변경된 속성 적용
  for (const name in nextStyle) {
    const value = nextStyle[name];
    if (styleDecl[name as any] !== value) styleDecl[name as any] = value;
  }
}
