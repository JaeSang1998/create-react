export type ElementType = string | symbol | ((props: any) => VNode | null);

export type VNode = {
  type: ElementType;
  props: {
    children: VNode[];
    [key: string]: any;
  };
  key: string | number | null;
  dom?: Node | null;
  child?: VNode | null;
  hooks?: any[];
};

// 전역 상태 및 상수
const TEXT_ELEMENT = Symbol("TEXT_ELEMENT");
let currentRoot: VNode | null = null;
let currentComponent: VNode | null = null;
let hookIndex = 0;
let rootContainer: Element | DocumentFragment | null = null;
const pendingEffects: Array<() => void> = [];
const eventListeners = new WeakMap<Node, Record<string, EventListener>>();

// 공개 API
export const createElement = (
  type: ElementType,
  props: { [key: string]: any } | null,
  ...children: any[]
): VNode => {
  const { key, ..._props } = props || {};

  const childrenElements: VNode[] = children
    .filter((child) => child !== null && child !== undefined)
    .map((child) => {
      if (typeof child === "object" && child.type) {
        return child as VNode;
      } else {
        return createTextElement(String(child));
      }
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

export const render = (vNode: VNode, root: Element | DocumentFragment) => {
  rootContainer = root;
  hookIndex = 0;
  reconcile(root, currentRoot, vNode);
  currentRoot = vNode;

  const effectsToRun = [...pendingEffects];
  pendingEffects.length = 0;
  effectsToRun.forEach((effect) => effect());
};

export function useState<S>(initial: S): [S, (v: S | ((p: S) => S)) => void] {
  if (!currentComponent) {
    throw new Error("useState는 함수 컴포넌트 내부에서만 호출해야 합니다.");
  }

  currentComponent.hooks = currentComponent.hooks || [];
  const hooks = currentComponent.hooks;

  if (hooks.length <= hookIndex) {
    hooks.push(initial);
  }

  const state: S = hooks[hookIndex] as S;
  const currentIndex = hookIndex;
  hookIndex++; // 다음 hook을 위해 인덱스 증가

  const setState = (value: S | ((prevState: S) => S)) => {
    const currentState = hooks[currentIndex] as S;
    const nextState =
      typeof value === "function"
        ? (value as (prevState: S) => S)(currentState)
        : value;

    if (currentState !== nextState) {
      hooks[currentIndex] = nextState;
      if (rootContainer && currentRoot) {
        render(currentRoot, rootContainer);
      }
    }
  };

  return [state, setState];
}

export function useEffect(effect: () => (() => void) | void, deps?: any[]) {
  if (!currentComponent) {
    throw new Error("useEffect는 함수 컴포넌트 내부에서만 호출해야 합니다.");
  }

  currentComponent.hooks = currentComponent.hooks || [];
  const hooks = currentComponent.hooks;
  const effectHookIndex = hookIndex; // 현재 effect를 위한 인덱스 저장
  hookIndex++; // 다음 hook을 위해 인덱스 증가

  const oldHookData = hooks[effectHookIndex] as
    | { deps?: any[]; cleanup?: () => void }
    | undefined;
  let depsHaveChanged: boolean;

  if (deps === undefined) {
    // 경우 1: 의존성 배열이 없는 경우, 항상 effect 실행
    depsHaveChanged = true;
  } else {
    // 경우 2: 의존성 배열이 있는 경우
    if (!oldHookData || !oldHookData.deps) {
      // 현재 hook의 첫 실행이거나, 이전 실행 시 의존성 배열이 없었던 경우
      depsHaveChanged = true;
    } else if (deps.length !== oldHookData.deps.length) {
      // 의존성 배열들의 길이가 다른 경우
      depsHaveChanged = true;
    } else {
      // 의존성 배열들의 길이가 같으므로, 요소들을 비교
      depsHaveChanged = deps.some((dep, i) => dep !== oldHookData!.deps![i]);
    }
  }

  if (depsHaveChanged) {
    const oldCleanup = oldHookData?.cleanup;
    const componentInstance = currentComponent; // 클로저를 위해 currentComponent 저장

    pendingEffects.push(() => {
      if (oldCleanup) {
        oldCleanup();
      }
      const newCleanup = effect();
      if (componentInstance.hooks) {
        componentInstance.hooks[effectHookIndex] = {
          deps,
          cleanup: newCleanup,
        };
      }
    });
  }
}

// 핵심 재조정 로직

// VNode와 그 자식들의 cleanup effect를 실행하는 헬퍼 함수
function unmountVNode(vnode: VNode) {
  // 1. 컴포넌트인 경우 VNode 자체의 cleanup effect 실행
  if (typeof vnode.type === "function" && vnode.hooks) {
    vnode.hooks.forEach((hook) => {
      if (hook && typeof hook.cleanup === "function") {
        hook.cleanup();
        hook.cleanup = undefined; // 중복 cleanup 방지
      }
    });
  }

  // 2. 자식들을 재귀적으로 unmount
  if (vnode.child) {
    // VNode가 컴포넌트였다면, 직접 렌더링된 자식은 vnode.child
    unmountVNode(vnode.child);
  } else if (vnode.type !== TEXT_ELEMENT && typeof vnode.type !== "function") {
    // VNode가 호스트 요소였다면, props의 자식들을 unmount
    vnode.props.children.forEach((child) => {
      unmountVNode(child);
    });
  }
}

const reconcile = (
  parentDom: Node,
  oldVNode: VNode | null,
  newVNode: VNode | null
) => {
  if (oldVNode === null) {
    // newVNode Mount
    if (newVNode === null) return;

    if (typeof newVNode.type === "function") {
      reconcileComponent(parentDom, null, newVNode);
    } else {
      const dom = createDOM(newVNode);
      newVNode.dom = dom;
      parentDom.appendChild(dom);
      newVNode.props.children.forEach((child: VNode) =>
        reconcile(dom, null, child)
      );
    }
    return;
  }

  if (newVNode === null) {
    // oldVNode Unmount
    unmountVNode(oldVNode); // oldVNode와 그 하위 트리의 모든 cleanup effect 실행
    if (oldVNode.dom && oldVNode.dom.parentNode) {
      // DOM에서 제거하기 전에 parentNode 확인
      oldVNode.dom.parentNode.removeChild(oldVNode.dom);
    }
    return;
  }

  const typesDiffer = oldVNode.type !== newVNode.type;
  const keysDiffer = oldVNode.key !== newVNode.key;

  // 타입 또는 키 변경 시 oldVNode unmount 및 newVNode mount
  if (
    typesDiffer ||
    (keysDiffer && oldVNode.key !== null && newVNode.key !== null)
  ) {
    unmountVNode(oldVNode); // DOM 제거 전 cleanup 실행
    if (oldVNode.dom && oldVNode.dom.parentNode) {
      // parentNode 확인
      oldVNode.dom.parentNode.removeChild(oldVNode.dom);
    }
    reconcile(parentDom, null, newVNode); // newVNode를 mount
    return;
  }

  // 타입과 키가 같은 경우 (업데이트)
  if (typeof newVNode.type === "function") {
    reconcileComponent(parentDom, oldVNode, newVNode);
  } else {
    // 호스트 요소 업데이트
    const dom = (newVNode.dom = oldVNode.dom!); // DOM 재사용
    if (newVNode.type === TEXT_ELEMENT) {
      if (oldVNode.props.value !== newVNode.props.value) {
        (dom as Text).nodeValue = newVNode.props.value;
      }
    } else {
      updateDOMProps(dom, oldVNode.props, newVNode.props);
    }
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

  if (oldVNode && oldVNode.hooks) {
    newVNode.hooks = oldVNode.hooks;
  } else {
    newVNode.hooks = [];
  }

  const oldChildVNode = oldVNode?.child ?? null;
  let renderedOutput = (newVNode.type as Function)(newVNode.props);

  if (renderedOutput === null || renderedOutput === undefined) {
    reconcile(parentDom, oldChildVNode, null); // 컴포넌트가 null을 반환하면 자식 unmount
    newVNode.child = null;
    newVNode.dom = null;
  } else {
    if (
      typeof renderedOutput !== "object" ||
      renderedOutput.type === undefined // VNode가 아닌 경우 (문자열, 숫자 등)
    ) {
      renderedOutput = createTextElement(String(renderedOutput));
    }
    newVNode.child = renderedOutput as VNode;
    reconcile(parentDom, oldChildVNode, renderedOutput as VNode);
    newVNode.dom = (renderedOutput as VNode).dom; // 컴포넌트의 DOM은 렌더링된 자식의 DOM
  }
}

function reconcileChildren(
  containerDomNode: Node,
  oldChildren: VNode[],
  newChildren: VNode[]
) {
  const oldKeyedChildrenMap = new Map<string | number | null, VNode>();
  oldChildren.forEach((child) => {
    if (child.key !== null && child.key !== undefined) {
      oldKeyedChildrenMap.set(child.key, child);
    }
  });

  const oldKeylessChildren = oldChildren.filter(
    (child) => child.key === null || child.key === undefined
  );
  let oldKeylessIndex = 0;

  // 새 자식들을 기준으로 재조정
  newChildren.forEach((newChild) => {
    let oldChild: VNode | null = null;
    if (newChild.key !== null && newChild.key !== undefined) {
      // 키가 있는 자식
      oldChild = oldKeyedChildrenMap.get(newChild.key) || null;
      if (oldChild) {
        oldKeyedChildrenMap.delete(newChild.key); // 매칭된 자식은 맵에서 제거
      }
    } else {
      // 키가 없는 자식 (순서 기반 매칭 시도)
      if (oldKeylessIndex < oldKeylessChildren.length) {
        oldChild = oldKeylessChildren[oldKeylessIndex++];
      }
    }
    reconcile(containerDomNode, oldChild, newChild);
  });

  // 남은 이전 자식들 (keyed) unmount
  oldKeyedChildrenMap.forEach((oldChild) =>
    reconcile(containerDomNode, oldChild, null)
  );
  // 남은 이전 자식들 (keyless) unmount
  for (let i = oldKeylessIndex; i < oldKeylessChildren.length; i++) {
    reconcile(containerDomNode, oldKeylessChildren[i], null);
  }

  // DOM 노드 순서 재정렬
  let previousNode: Node | null = null;
  for (let i = 0; i < newChildren.length; i++) {
    const childVNode = newChildren[i];
    const currentNode = childVNode.dom!;

    if (previousNode === null) {
      // 첫 번째 자식
      if (containerDomNode.firstChild !== currentNode) {
        containerDomNode.insertBefore(currentNode, containerDomNode.firstChild);
      }
    } else {
      // 이후 자식들
      if (previousNode.nextSibling !== currentNode) {
        containerDomNode.insertBefore(currentNode, previousNode.nextSibling);
      }
    }
    previousNode = currentNode;
  }
}

// DOM 헬퍼 함수
const createTextElement = (text: string): VNode => {
  return {
    type: TEXT_ELEMENT,
    key: null,
    props: {
      value: text,
      children: [],
    },
  };
};

const createDOM = (vNode: VNode): Node => {
  if (vNode.type === TEXT_ELEMENT) {
    return document.createTextNode(vNode.props.value);
  }

  const domElement = document.createElement(vNode.type as string);
  updateDOMProps(domElement, {}, vNode.props); // 초기 props 적용
  vNode.dom = domElement;

  return domElement;
};

function updateDOMProps(
  dom: Node,
  prevProps: Record<string, any>,
  nextProps: Record<string, any>
) {
  const el = dom as HTMLElement;
  const currentListeners = eventListeners.get(el) || {};

  // 이전 속성 및 이벤트 리스너 제거
  Object.keys(prevProps).forEach((key) => {
    if (key === "children" || key === "key") return;

    // 다음 props에 없거나 값이 변경된 경우
    if (!(key in nextProps) || prevProps[key] !== nextProps[key]) {
      if (key.startsWith("on")) {
        // 이벤트 리스너
        const eventType = key.slice(2).toLowerCase();
        if (prevProps[key]) {
          el.removeEventListener(eventType, prevProps[key] as EventListener);
        }
        delete currentListeners[eventType];
      } else if (key === "style") {
        // 스타일
        if (!(key in nextProps) || typeof nextProps[key] !== "object") {
          el.style.cssText = ""; // 스타일 객체가 아니거나 제거되면 cssText 초기화
        }
      } else if (key === "className") {
        el.removeAttribute("class");
      } else {
        // 기타 속성
        el.removeAttribute(key);
      }
    }
  });

  // 새 속성 및 이벤트 리스너 설정
  Object.keys(nextProps).forEach((key) => {
    if (key === "children" || key === "key") return;

    const nextVal = nextProps[key];
    const prevVal = prevProps[key];

    // 값이 변경되지 않았으면 건너뛰기 (style 객체는 제외)
    if (
      prevVal === nextVal &&
      (typeof nextVal !== "object" || nextVal === null) &&
      key !== "style"
    )
      return;

    if (key.startsWith("on")) {
      // 이벤트 리스너
      const eventType = key.slice(2).toLowerCase();
      if (prevVal && prevVal !== nextVal) {
        // 이전 리스너가 있고 새 리스너와 다르면 제거
        el.removeEventListener(eventType, prevVal as EventListener);
      }
      if (nextVal) {
        // 새 리스너 등록
        el.addEventListener(eventType, nextVal as EventListener);
        currentListeners[eventType] = nextVal as EventListener;
      }
    } else if (key === "style") {
      // 스타일
      if (typeof nextVal === "object" && nextVal !== null) {
        // 스타일 객체인 경우
        const style = el.style;
        const oldStyleObj =
          typeof prevVal === "object" && prevVal !== null ? prevVal : {};

        // 이전 스타일에 있었지만 새 스타일에 없는 속성 제거
        for (const styleName in oldStyleObj) {
          if (!(nextVal && nextVal.hasOwnProperty(styleName))) {
            style[styleName as any] = "";
          }
        }
        // 새 스타일 또는 변경된 스타일 적용
        for (const styleName in nextVal) {
          if (style[styleName as any] !== nextVal[styleName]) {
            style[styleName as any] = nextVal[styleName];
          }
        }
      } else {
        // 스타일이 문자열이거나 null/undefined 인 경우
        el.style.cssText = (nextVal as string) || "";
      }
    } else if (key === "className") {
      if (nextVal) {
        el.setAttribute("class", String(nextVal));
      } else {
        el.removeAttribute("class");
      }
    } else {
      // 기타 속성
      if (nextVal === null || nextVal === undefined || nextVal === false) {
        // boolean 속성이 false이면 제거 (예: disabled)
        el.removeAttribute(key);
      } else {
        // boolean true는 빈 문자열로, 나머지는 문자열 값으로 설정
        el.setAttribute(
          key,
          typeof nextVal === "boolean" ? "" : String(nextVal)
        );
      }
    }
  });

  if (Object.keys(currentListeners).length > 0) {
    eventListeners.set(el, currentListeners);
  } else {
    eventListeners.delete(el); // 리스너가 없으면 WeakMap에서 제거
  }
}
