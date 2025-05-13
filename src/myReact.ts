export type ElementType = string | symbol | Function | null;

export type VNode = {
  type: ElementType;
  props: {
    children: VNode[];
    [key: string]: any;
  };
  key?: string | number | null; // ← key 필드 추가
  dom?: Node | null;
  child?: VNode | null;
  hooks?: any[]; // ← 상태 저장소
};

let currentRoot: VNode | null = null;
const TEXT_ELEMENT = Symbol("TEXT_ELEMENT");

let currentComponent: VNode | null = null; // 지금 렌더 중인 컴포넌트
let hookIndex = 0; // 컴포넌트 내부 훅 호출 순서
let rootContainer: Element | DocumentFragment | null = null; // 루트 DOM (전체 리렌더용)

export const render = (vNode: VNode, container: Element | DocumentFragment) => {
  if (!rootContainer) rootContainer = container; // 최초 한 번만 저장

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
    if (typeof newVNode.type === "function") {
      reconcileComponent(parent, oldVNode, newVNode);
      return;
    }
    const dom = createDOM(newVNode);
    parent.appendChild(dom);
    newVNode.dom = dom;
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
  if (oldVNode && oldVNode.type !== newVNode.type) {
    if (typeof newVNode.type === "function") {
      // old DOM 통째 제거
      parent.removeChild(oldVNode.dom!);
      reconcileComponent(parent, null, newVNode);
      return;
    }

    const dom = createDOM(newVNode);
    newVNode.dom = dom;
    parent.replaceChild(dom, oldVNode.dom!);
    newVNode.props.children.forEach((child: VNode) => {
      reconcile(dom, null, child);
    });
    return;
  }

  if (typeof newVNode.type === "function") {
    // 컴포넌트
    reconcileComponent(parent, oldVNode, newVNode);
    return;
  }

  const dom = (newVNode.dom = oldVNode.dom!);
  if (newVNode.type === TEXT_ELEMENT) {
    dom.textContent = newVNode.props.value;
  } else {
    updateDOMProps(dom, oldVNode!.props, newVNode!.props);
    reconcileChildren(dom, oldVNode.props.children, newVNode.props.children);
  }
};

function reconcileComponent(
  parentDom: Node,
  oldVNode: VNode | null,
  newVNode: VNode
) {
  currentComponent = newVNode;
  hookIndex = 0;

  // 이전에 사용된 hooks가 있으면 재사용
  if (oldVNode) {
    newVNode.hooks = oldVNode.hooks;
  }

  const oldChild = oldVNode?.child ?? null;
  let newChild = (newVNode.type as Function)(newVNode.props);

  if (newChild === null) {
    reconcile(parentDom, oldChild, null);
    return;
  }

  if (typeof newChild !== "object") {
    newChild = createTextElement(newChild as string);
  }

  // // key가 같으면 dom/hook 복사
  // if (oldChild && oldChild.key === newChild.key) {
  //   newChild.dom = oldChild.dom;
  //   newChild.hooks = oldChild.hooks;
  // }

  newVNode.child = newChild;
  reconcile(parentDom, oldChild, newChild);
  newVNode.dom = newChild.dom;

  currentComponent = null;
}

export function useState<S>(initial: S): [S, (v: S | ((p: S) => S)) => void] {
  if (!currentComponent) {
    throw new Error("useState는 함수 컴포넌트 내부에서만 호출해야 합니다");
  }

  const hooks = (currentComponent.hooks ||= []);
  // 첫 호출이면 초기값 저장
  if (hooks.length <= hookIndex) hooks.push(initial);

  const state: S = hooks[hookIndex];
  const idx = hookIndex; // 클로저로 캡처
  hookIndex++;

  const setState = (value: S | ((p: S) => S)) => {
    const next =
      typeof value === "function" ? (value as (p: S) => S)(hooks[idx]) : value;
    hooks[idx] = next;

    // 간단 구현: 전체 트리 다시 렌더
    if (rootContainer && currentRoot) {
      render(currentRoot, rootContainer);
    }
  };

  return [state, setState];
}

function reconcileChildren(
  parentDom: Node,
  oldChildren: VNode[],
  newChildren: VNode[]
) {
  // key → oldVNode 매핑
  const oldMap = new Map<string | number | null, VNode>();
  oldChildren.forEach((c, i) => oldMap.set(c.key ?? i, c));

  // mount / update
  newChildren.forEach((newChild, i) => {
    const key = newChild.key ?? i;
    const old = oldMap.get(key) ?? null;
    reconcile(parentDom, old, newChild);
    oldMap.delete(key);
  });

  // unmount
  oldMap.forEach((old) => reconcile(parentDom, old, null));

  // DOM 순서 맞추기
  let last: Node | null = null;
  newChildren.forEach((c) => {
    if (!c.dom) return;

    const dom = c.dom;
    const anchor = last ? last.nextSibling : parentDom.firstChild;

    // dom이 이미 올바른 위치에 있으면 건너뜀
    if (dom === anchor) {
      last = dom;
      return;
    }

    // anchor가 null이면 맨 뒤에 추가
    if (!anchor) {
      parentDom.appendChild(dom);
    } else {
      // 그 외에는 정해진 위치에 삽입
      parentDom.insertBefore(dom, anchor);
    }

    last = dom;
  });
}

const createDOM = (vNode: VNode): Node => {
  if (vNode.type === TEXT_ELEMENT) {
    return document.createTextNode(vNode.props.value);
  }

  const domElement = document.createElement(vNode.type as string);
  updateDOMProps(domElement, {}, vNode.props); // 초기 props 적용
  vNode.dom = domElement;

  return domElement;
};

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
  const { key, ..._props } = props || {};
  const childrenElements = children
    .flat()
    .filter((child) => child != null) // null과 undefined 제거
    .map((child) => {
      console.log(child);
      if (typeof child === "object" && child.type) {
        return child as VNode;
      }
      return createTextElement(child as string);
    });

  return {
    type,
    key: key === undefined ? null : key,
    props: {
      ..._props,
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
  // Only proceed if dom is an Element (not a Text node)
  if (!(dom instanceof Element)) return;
  const el = dom as HTMLElement;

  /**
   * 전역 WeakMap<HTMLElement, Record<string, EventListener>>
   * 각 노드에 연결된 이벤트 리스너를 추적해
   * 중복 바인딩과 메모리 누수를 방지합니다.
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
      // 대문자 이벤트명 정규화: onClick -> click
      const eventName = key.slice(2).toLowerCase();

      if (prevVal) {
        el.removeEventListener(eventName, prevVal as EventListener);
      }

      if (nextVal && typeof nextVal === "function") {
        el.addEventListener(eventName, nextVal as EventListener);
        currentListeners[eventName] = nextVal as EventListener;
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
