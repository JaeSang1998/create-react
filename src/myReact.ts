// ======== TYPES & CONSTANTS ========
export type ElementType = string | symbol | Function | null;

export type VNode = {
  type: ElementType;
  props: {
    children: VNode[];
    [key: string]: any;
  };
  key?: string | number | null;
  dom?: Node | null;
  child?: VNode | null;
  hooks?: any[];
  parent?: Node | null;
  parentVNode?: VNode | null;
};

type EffectRecord = {
  deps: any[] | undefined;
  cleanup?: () => void;
  callback: () => void | (() => void);
};

const TEXT_ELEMENT = Symbol("TEXT_ELEMENT");

// ======== GLOBAL STATE & UTILITIES ========
let currentRoot: VNode | null = null;
let currentComponent: VNode | null = null;
let hookIndex = 0;
let pendingEffects: Array<() => void> = [];

// Used by updateDOMProps to track event listeners
const eventListeners = new WeakMap<Node, Record<string, EventListener>>();

// ======== ELEMENT CREATION ========
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
    .filter((child) => child != null)
    .map((child) => {
      if (typeof child === "object" && child.type) {
        return child as VNode;
      }
      return createTextElement(String(child));
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

// ======== DOM MANIPULATION UTILITIES ========
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

const createDOM = (vNode: VNode): Node => {
  if (vNode.type === TEXT_ELEMENT) {
    return document.createTextNode(vNode.props.value);
  }

  const domElement = document.createElement(vNode.type as string);
  updateDOMProps(domElement, {}, vNode.props);
  vNode.dom = domElement;

  return domElement;
};

// ======== CORE RENDERING & RECONCILIATION ========
export const render = (vNode: VNode, container: Element | DocumentFragment) => {
  currentRoot = vNode;
  reconcile(container, null, currentRoot, vNode);
  flushEffects();
};

const reconcile = (
  parent: Node,
  parentVNode: VNode | null,
  oldVNode: VNode | null,
  newVNode: VNode | null
): void => {
  if (newVNode) {
    newVNode.parent = parent;
    newVNode.parentVNode = parentVNode;
  }

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
      reconcile(dom, newVNode, null, child);
    });
    return;
  }

  if (newVNode === null) {
    if (oldVNode?.hooks) {
      oldVNode.hooks.forEach((h) => {
        if (h && (h as EffectRecord).cleanup) {
          (h as EffectRecord).cleanup!();
        }
      });
    }
    parent.removeChild(oldVNode.dom!);
    return;
  }

  if (oldVNode && oldVNode.type !== newVNode.type) {
    if (typeof newVNode.type === "function") {
      parent.removeChild(oldVNode.dom!);
      reconcileComponent(parent, null, newVNode);
      return;
    }

    const dom = createDOM(newVNode);
    newVNode.dom = dom;
    parent.replaceChild(dom, oldVNode.dom!);
    newVNode.props.children.forEach((child: VNode) => {
      reconcile(dom, newVNode, null, child);
    });
    return;
  }

  if (typeof newVNode.type === "function") {
    reconcileComponent(parent, oldVNode, newVNode);
    return;
  }

  const dom = (newVNode.dom = oldVNode.dom!);
  if (newVNode.type === TEXT_ELEMENT) {
    dom.textContent = newVNode.props.value;
  } else {
    updateDOMProps(dom, oldVNode!.props, newVNode!.props);
    reconcileChildren(
      dom,
      newVNode,
      oldVNode.props.children,
      newVNode.props.children
    );
  }
};

function reconcileComponent(
  parent: Node,
  oldVNode: VNode | null,
  newVNode: VNode
) {
  currentComponent = newVNode;
  hookIndex = 0;

  if (oldVNode) newVNode.hooks = oldVNode.hooks;

  const oldChild = oldVNode?.child ?? null;
  let newChild = (newVNode.type as Function)(newVNode.props);

  if (newChild === null) {
    reconcile(parent, newVNode, oldChild, null);
    return;
  }

  if (typeof newChild !== "object") {
    newChild = createTextElement(newChild as string);
  }

  newVNode.child = newChild;
  reconcile(parent, newVNode, oldChild, newChild);
  newVNode.dom = newChild.dom;

  currentComponent = null;
}

function reconcileChildren(
  parent: Node,
  parentVNode: VNode,
  oldChildren: VNode[],
  newChildren: VNode[]
) {
  const oldMap = new Map<string | number | null, VNode>();
  oldChildren.forEach((c, i) => oldMap.set(c.key ?? i, c));

  newChildren.forEach((newChild, i) => {
    const key = newChild.key ?? i;
    const old = oldMap.get(key) ?? null;
    reconcile(parent, parentVNode, old, newChild);
    oldMap.delete(key);
  });

  oldMap.forEach((old) => reconcile(parent, parentVNode, old, null));

  let last: Node | null = null;
  newChildren.forEach((c) => {
    if (!c.dom) return;

    const dom = c.dom;
    const anchor = last ? last.nextSibling : parent.firstChild;

    if (dom === anchor) {
      last = dom;
      return;
    }

    if (!anchor) {
      parent.appendChild(dom);
    } else {
      parent.insertBefore(dom, anchor);
    }

    last = dom;
  });
}

// ======== HOOKS & EFFECTS ========
export function useState<S>(initial: S): [S, (v: S | ((p: S) => S)) => void] {
  if (!currentComponent) {
    throw new Error("useState는 함수 컴포넌트 내부에서만 호출해야 합니다");
  }

  const owner = currentComponent;
  const hooks = (owner.hooks ||= []);

  if (hooks.length <= hookIndex) hooks.push(initial);

  const state: S = hooks[hookIndex];
  const idx = hookIndex;
  hookIndex++;

  const setState = (value: S | ((p: S) => S)) => {
    const next =
      typeof value === "function" ? (value as (p: S) => S)(hooks[idx]) : value;
    hooks[idx] = next;
    rerenderSubtree(owner!);
  };

  return [state, setState];
}

export function useEffect(callback: () => void | (() => void), deps?: any[]) {
  if (!currentComponent) {
    throw new Error("useEffect는 함수 컴포넌트 안에서만 호출하세요");
  }

  const hooks = (currentComponent.hooks ||= []);
  if (hooks.length <= hookIndex) {
    hooks.push({ deps, callback } as EffectRecord);
    scheduleEffect(currentComponent, hooks[hookIndex] as EffectRecord);
  } else {
    const effect = hooks[hookIndex] as EffectRecord;
    const prevDeps = effect.deps;
    let changed = false;
    if (deps === undefined) changed = true;
    else if (prevDeps === undefined) changed = true;
    else if (deps.length !== prevDeps.length) changed = true;
    else {
      for (let i = 0; i < deps.length; i++) {
        if (!Object.is(deps[i], prevDeps[i])) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      effect.deps = deps;
      effect.callback = callback;
      scheduleEffect(currentComponent, effect);
    }
  }
  hookIndex++;
}

// ======== HOOK HELPERS & EFFECT SCHEDULING ========
function rerenderSubtree(vNode: VNode) {
  if (typeof vNode.type !== "function") return;

  currentComponent = vNode;
  hookIndex = 0;

  let next = (vNode.type as Function)(vNode.props);
  if (next == null || typeof next !== "object") {
    next = createTextElement(String(next ?? ""));
  }

  const parent = vNode.parent!;
  next.parent = parent;
  next.parentVNode = vNode;

  reconcile(parent, vNode, vNode.child || null, next);

  vNode.child = next;
  vNode.dom = next.dom;

  currentComponent = null;
  flushEffects();
}

function scheduleEffect(vnode: VNode, effect: EffectRecord) {
  pendingEffects.push(() => {
    if (effect.cleanup) effect.cleanup();
    const ret = effect.callback();
    if (typeof ret === "function") {
      effect.cleanup = ret as () => void;
    } else {
      effect.cleanup = undefined;
    }
  });
}

function flushEffects() {
  const queue = pendingEffects;
  pendingEffects = [];
  queue.forEach((fn) => fn());
}
